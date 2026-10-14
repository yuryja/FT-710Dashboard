#include "controller_mac.hpp"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>

namespace app {
namespace {
std::string toUtf8(const std::wstring& ws) {
    std::string s;
    s.reserve(ws.size());
    for (wchar_t wc : ws) {
        if (wc < 128 && wc >= 0) s.push_back(static_cast<char>(wc));
        else if (wc < 0x800) {
            s.push_back(static_cast<char>(0xc0 | (wc >> 6)));
            s.push_back(static_cast<char>(0x80 | (wc & 0x3f)));
        } else {
            s.push_back(static_cast<char>(0xe0 | (wc >> 12)));
            s.push_back(static_cast<char>(0x80 | ((wc >> 6) & 0x3f)));
            s.push_back(static_cast<char>(0x80 | (wc & 0x3f)));
        }
    }
    return s;
}

std::string boolean(bool v) { return v ? "true" : "false"; }

std::string array(const std::vector<std::string>& values) {
    std::string out = "[";
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i) out += ",";
        out += web::json(values[i]);
    }
    return out + "]";
}

double number(const std::string& value, double minimum, double maximum, bool integer = false) {
    std::size_t count = 0;
    double result = std::stod(value, &count);
    if (count != value.size() || !std::isfinite(result) || result < minimum || result > maximum || (integer && result != std::trunc(result)))
        throw std::invalid_argument("Value is outside the allowed range");
    return result;
}
}

ControllerMac::ControllerMac() = default;

ControllerMac::~ControllerMac() {
    shutdown();
}

void ControllerMac::log(const std::string& message) {
    std::cout << "[FT-710] " << message << std::endl;
    {
        std::lock_guard lock(activityMutex_);
        activity_.push_back(message);
        if (activity_.size() > 500) activity_.erase(activity_.begin());
    }
}

void ControllerMac::initialize(bool demo, const std::string& serialPort, int baud, const std::string& passcode) {
    running_ = true;
    demo_ = demo;

    if (demo) {
        connectionKind_ = 2; // Dummy demo
        endpoint_ = "Dummy";
        webAccessCode_ = passcode.empty() ? "demo" : passcode;
    } else {
        connectionKind_ = 0; // USB CAT
        endpoint_ = serialPort.empty() ? "/dev/cu.SLAB_USBtoUART" : serialPort;
        webAccessCode_ = passcode.empty() ? web::randomToken().substr(0, 16) : passcode;
    }
    baud_ = baud;

    worker_ = std::make_unique<radio::Worker>(
        [this](const radio::Snapshot& s) { onRadioUpdate(s); },
        [this](const std::string& msg) { log(msg); }
    );

    webServer_ = std::make_unique<web::Server>(
        [this](std::shared_ptr<web::Request> req) { handleWebRequest(req); },
        [this](const std::string& msg) { log(msg); }
    );

    const char* home = std::getenv("HOME");
    std::filesystem::path certDir = home ? (std::filesystem::path(home) / ".config" / "ft710") : ".";
    std::wstring certDirW = certDir.wstring();
    webServer_->start(certDirW, webAccessCode_);

    connectRadio();
    if (sharingWanted_) startSharing();
}

void ControllerMac::connectRadio() {
    radio::Command cmd;
    cmd.action = radio::Action::Connect;
    cmd.connection.type = static_cast<radio::ConnectionType>(connectionKind_);
    cmd.connection.endpoint = endpoint_;
    cmd.connection.baud = baud_;
    cmd.connection.stopBits = stopBits_;
    cmd.connection.handshake = flow_;
    cmd.connection.pollMs = pollMs_;
    worker_->submit(std::move(cmd));
}

void ControllerMac::disconnectRadio() {
    radio::Command cmd;
    cmd.action = radio::Action::Disconnect;
    worker_->submit(std::move(cmd));
}

void ControllerMac::startSharing() {
    if (!catServer_) {
        catServer_ = std::make_unique<CatServer>(
            [this](std::shared_ptr<radio::CatJob> job) {
                return worker_->request(job);
            },
            [this](const std::string& msg) { log(msg); }
        );
    }
    try {
        catServer_->start(sharePort_, 1);
        sharingError_.clear();
    } catch (const std::exception& e) {
        sharingError_ = e.what();
        log("CAT sharing error: " + sharingError_);
    }
}

void ControllerMac::stopSharing() {
    if (catServer_) catServer_->stop();
}

void ControllerMac::releasePtt() {
    if (browserPttOwner_ || pttPending_ || state_.dashboardPtt) {
        radio::Command cmd;
        cmd.action = radio::Action::PttOff;
        worker_->submit(std::move(cmd));
    }
    browserPttOwner_ = 0;
    pttPending_ = false;
    microphoneAudio_.gate(false);
}

void ControllerMac::onRadioUpdate(const radio::Snapshot& newState) {
    {
        std::lock_guard lock(stateMutex_);
        state_ = newState;
    }
    publishWeb();

    // Check PTT timeout
    if (browserPttOwner_ && state_.transmitting) {
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now() - pttRequested_).count();
        if (elapsed > pttLimitSeconds_) {
            log("PTT watchdog timer expired (" + std::to_string(pttLimitSeconds_) + "s). Cutting transmission.");
            releasePtt();
        }
    }
}

void ControllerMac::handleWebRequest(std::shared_ptr<web::Request> request) {
    try {
        const auto& f = request->fields;
        auto get = [&](const char* k) { auto it = f.find(k); return it != f.end() ? it->second : ""; };
        auto action = get("action");
        auto vfo = get("vfo");

        radio::Command cmd;
        cmd.vfo = (vfo == "B") ? RIG_VFO_B : RIG_VFO_A;

        if (action == "connect") {
            connectionKind_ = std::stoi(get("kind"));
            endpoint_ = get("endpoint");
            baud_ = std::stoi(get("baud"));
            stopBits_ = std::stoi(get("stopBits"));
            flow_ = get("flow");
            pollMs_ = std::stoi(get("poll"));
            connectRadio();
        } else if (action == "disconnect") {
            disconnectRadio();
        } else if (action == "ptt") {
            if (get("enabled") == "0") {
                releasePtt();
            } else {
                if (!state_.online || state_.busy || !state_.canPtt || !state_.pttKnown || state_.releasePending)
                    throw std::runtime_error("Radio PTT is unavailable or release is pending");
                if (browserPttOwner_ || pttPending_ || state_.dashboardPtt || (state_.pttKnown && state_.transmitting))
                    throw std::runtime_error("PTT is already active; release it first");

                const long limits[]{30, 60, 180, 300, 600};
                cmd.action = radio::Action::PttOn;
                cmd.width = limits[std::clamp(std::stoi(get("limit").empty() ? "2" : get("limit")), 0, 4)];
                pttLimitSeconds_ = static_cast<int>(cmd.width);
                browserPttOwner_ = request->client;
                pttPending_ = true;
                pttRequested_ = std::chrono::steady_clock::now();
                worker_->submit(std::move(cmd));
            }
        } else if (action == "browserGone") {
            if (browserPttOwner_ == request->client) {
                log("Client " + std::to_string(request->client) + " disconnected while holding PTT. Safety release.");
                releasePtt();
            }
            browserMicClients_.erase(request->client);
        } else if (action == "browserMic") {
            bool en = get("enabled") == "1";
            if (en) browserMicClients_.insert(request->client);
            else browserMicClients_.erase(request->client);
        } else if (action == "sharing") {
            sharingWanted_ = get("enabled") == "1";
            sharePort_ = static_cast<unsigned>(number(get("port"), 1, 65535, true));
            if (sharingWanted_) startSharing();
            else stopSharing();
        } else if (action == "audioRoute") {
            bool isMic = get("route") == "microphone";
            bool en = get("enabled") == "1";
            if (isMic) {
                microphoneWanted_ = en;
                if (en) microphoneAudio_.start(L"", L"");
                else microphoneAudio_.stop();
            } else {
                receiveWanted_ = en;
                if (en) {
                    receiveAudio_.receivedAudio(true);
                    receiveAudio_.start(L"", L"");
                } else {
                    receiveAudio_.stop();
                }
            }
        } else if (action == "audioLevel") {
            bool isMic = get("route") == "microphone";
            float val = std::stof(get("value")) / 100.0f;
            if (isMic) { micGain_ = val; microphoneAudio_.gain(val); }
            else { receiveGain_ = val; receiveAudio_.gain(val); }
        } else if (action == "frequency") {
            cmd.action = radio::Action::Frequency;
            cmd.number = number(get("hz"), 30000, 60000000);
            worker_->submit(std::move(cmd));
        } else if (action == "step") {
            cmd.action = radio::Action::StepFrequency;
            cmd.number = number(get("hz"), -1000000, 1000000);
            worker_->submit(std::move(cmd));
        } else if (action == "mode") {
            cmd.action = radio::Action::Mode;
            cmd.text = get("mode");
            cmd.width = static_cast<long>(number(get("width").empty() ? "0" : get("width"), 0, 100000, true));
            worker_->submit(std::move(cmd));
        } else if (action == "vfo") {
            cmd.action = radio::Action::SelectVfo;
            cmd.vfo = (vfo == "B") ? RIG_VFO_B : RIG_VFO_A;
            worker_->submit(std::move(cmd));
        } else if (action == "set") {
            cmd.action = radio::Action::Set;
            cmd.id = get("setting");
            cmd.text = get("value");
            worker_->submit(std::move(cmd));
        } else if (action == "swap") {
            cmd.action = radio::Action::Swap;
            worker_->submit(std::move(cmd));
        } else if (action == "copy") {
            cmd.action = radio::Action::CopyAtoB;
            worker_->submit(std::move(cmd));
        } else if (action == "refresh") {
            cmd.action = radio::Action::Refresh;
            worker_->submit(std::move(cmd));
        } else if (action == "powerOn") {
            cmd.action = radio::Action::PowerOn;
            worker_->submit(std::move(cmd));
        } else if (action == "powerOff") {
            cmd.action = radio::Action::PowerOff;
            releasePtt();
            worker_->submit(std::move(cmd));
        } else if (action == "rfStart") {
            rfCapture_.start();
        } else if (action == "rfStop") {
            rfCapture_.stop();
        } else if (action == "rfSpan") {
            rfCat2Port_ = get("port");
            rfSpan_ = static_cast<unsigned>(number(get("span"), 0, 9, true));
            rfCat2Baud_ = static_cast<unsigned>(number(get("baud"), 4800, 115200, true));
            rfWaterfallLevelDb_ = number(get("level"), -30, 30);
            std::wstring cat2PortW(rfCat2Port_.begin(), rfCat2Port_.end());
            rf_scope::applySpan(cat2PortW, rfSpan_, rfCat2Baud_, rfWaterfallLevelDb_);
        } else if (action == "clearLog") {
            std::lock_guard lock(activityMutex_);
            activity_.clear();
        }

        publishWeb();
        request->reply.set_value("\"ok\":true,\"queued\":true");
    } catch (const std::exception& e) {
        request->reply.set_value("\"ok\":false,\"error\":" + web::json(e.what()));
    }
}

void ControllerMac::publishWeb(bool urgent) {
    if (webServer_) {
        webServer_->publish(buildStateJson(), urgent);

        if (demo_) {
            auto& analyzer = receiveAudio_.spectrum();
            if (!demoSample_) {
                analyzer.enable(true);
                analyzer.configure(48000);
            }
            for (unsigned i = 0; i < 2400; ++i, ++demoSample_) {
                double t = demoSample_ / 48000.0;
                demoNoise_ = demoNoise_ * 1664525u + 1013904223u;
                float noise = (static_cast<float>(demoNoise_ >> 8) / 16777216.0f - 0.5f) * 0.003f;
                float tone = static_cast<float>(0.025 * std::sin(6.283185307179586 * 700 * t) +
                    0.012 * std::sin(6.283185307179586 * (1600 * t + 70 * std::sin(t))) +
                    0.006 * std::sin(6.283185307179586 * 2400 * t));
                analyzer.push(tone + noise);
            }
        }

        audio::SpectrumFrame frame;
        if (receiveAudio_.spectrum().poll(frame)) {
            webServer_->spectrum(frame);
        }

        rf_scope::Frame rfFrame;
        if (rfCapture_.latest(rfFrame)) {
            webServer_->rfSpectrum(rfFrame, rfFrame.centerHz, rf_scope::spanHz(rfFrame.spanIndex));
        }
    }
}

std::string ControllerMac::buildStateJson() {
    std::lock_guard lock(stateMutex_);
    const auto& s = state_;
    std::ostringstream out;

    out << "{\"type\":\"state\",\"generation\":" << s.generation
        << ",\"online\":" << boolean(s.online)
        << ",\"portOpen\":" << boolean(s.portOpen)
        << ",\"busy\":" << boolean(s.busy)
        << ",\"demo\":" << boolean(s.demo)
        << ",\"poweredOff\":" << boolean(s.poweredOff)
        << ",\"standby\":" << boolean(s.standby)
        << ",\"powerKnown\":" << boolean(s.powerKnown)
        << ",\"canPower\":" << boolean(s.canPower)
        << ",\"canPtt\":" << boolean(s.canPtt)
        << ",\"pttKnown\":" << boolean(s.pttKnown)
        << ",\"transmitting\":" << boolean(s.transmitting)
        << ",\"dashboardPtt\":" << boolean(s.dashboardPtt)
        << ",\"pttPending\":" << boolean(pttPending_)
        << ",\"releasePending\":" << boolean(s.releasePending)
        << ",\"browserOwner\":" << browserPttOwner_
        << ",\"micLease\":" << audio::browserAudio().lease()
        << ",\"status\":" << web::json(s.connectionStatus)
        << ",\"error\":" << web::json(s.error)
        << ",\"activeVfo\":" << web::json(s.activeVfo == RIG_VFO_B ? "B" : "A")
        << ",\"settingsVfo\":" << web::json(s.settingsVfo == RIG_VFO_A ? "A" : s.settingsVfo == RIG_VFO_B ? "B" : "Current")
        << ",\"modes\":" << array(s.modes)
        << ",\"vfos\":[";

    for (int i = 0; i < 2; ++i) {
        const auto& vfo = i ? s.b : s.a;
        if (i) out << ',';
        out << "{\"frequency\":" << radio::formatNumber(std::isfinite(vfo.frequency) ? vfo.frequency : 0)
            << ",\"frequencyValid\":" << boolean(vfo.frequencyValid)
            << ",\"mode\":" << web::json(vfo.mode)
            << ",\"modeValid\":" << boolean(vfo.modeValid)
            << ",\"width\":" << vfo.width
            << ",\"frequencyRevision\":" << s.frequencyRevision[i]
            << ",\"modeRevision\":" << s.modeRevision[i] << '}';
    }
    out << "],\"vfoRevision\":" << s.vfoRevision << ",\"settings\":[";

    auto now = std::chrono::steady_clock::now();
    for (unsigned i = 0; i < s.settings.size(); ++i) {
        const auto& setting = s.settings[i];
        if (i) out << ',';
        auto age = setting.valid ? std::chrono::duration_cast<std::chrono::milliseconds>(now - setting.updated).count() : -1;
        const char* type = setting.type == radio::ValueType::Boolean ? "boolean" :
                           setting.type == radio::ValueType::Choice ? "choice" :
                           setting.type == radio::ValueType::Text ? "text" :
                           setting.type == radio::ValueType::Real ? "real" : "integer";
        out << "{\"id\":" << web::json(setting.id)
            << ",\"name\":" << web::json(setting.name)
            << ",\"group\":" << web::json(setting.group)
            << ",\"description\":" << web::json(setting.description)
            << ",\"units\":" << web::json(setting.units)
            << ",\"type\":" << web::json(type)
            << ",\"readable\":" << boolean(setting.readable)
            << ",\"writable\":" << boolean(setting.writable)
            << ",\"valid\":" << boolean(setting.valid)
            << ",\"txOnly\":" << boolean(setting.txOnly)
            << ",\"bounded\":" << boolean(setting.bounded)
            << ",\"minimum\":" << radio::formatNumber(std::isfinite(setting.minimum) ? setting.minimum : 0)
            << ",\"maximum\":" << radio::formatNumber(std::isfinite(setting.maximum) ? setting.maximum : 0)
            << ",\"step\":" << radio::formatNumber(std::isfinite(setting.step) ? setting.step : 0)
            << ",\"choices\":" << array(setting.choices)
            << ",\"choiceValues\":" << array(setting.choiceValues)
            << ",\"value\":" << web::json(setting.value)
            << ",\"display\":" << web::json(radio::displayValue(setting))
            << ",\"range\":" << web::json(radio::rangeText(setting))
            << ",\"status\":" << web::json(setting.status)
            << ",\"age\":" << age << '}';
    }
    out << "],\"connection\":{\"kind\":" << connectionKind_
        << ",\"endpoint\":" << web::json(endpoint_)
        << ",\"baud\":" << web::json(std::to_string(baud_))
        << ",\"stopBits\":" << web::json(std::to_string(stopBits_))
        << ",\"flow\":" << web::json(flow_)
        << ",\"poll\":" << web::json(std::to_string(pollMs_))
        << "},\"sharing\":{\"wanted\":" << boolean(sharingWanted_)
        << ",\"running\":" << boolean(catServer_ && catServer_->running())
        << ",\"port\":" << web::json(std::to_string(sharePort_))
        << ",\"clients\":" << (catServer_ ? catServer_->clients() : 0)
        << ",\"error\":" << web::json(sharingError_)
        << "},\"audio\":{\"devices\":[";

    auto devList = audio::devices();
    for (unsigned i = 0; i < devList.size(); ++i) {
        const auto& d = devList[i];
        if (i) out << ',';
        std::string idStr = toUtf8(d.id);
        std::string nameStr = toUtf8(d.name);
        out << "{\"id\":" << web::json(idStr)
            << ",\"name\":" << web::json(nameStr)
            << ",\"input\":" << boolean(d.input)
            << ",\"remote\":" << boolean(d.remote) << '}';
    }
    out << "],\"maps\":[";
    out << "{\"label\":\"Radio receive\",\"id\":\"default\",\"status\":" << web::json(receiveAudio_.status().active ? "Active" : "Off") << "},";
    out << "{\"label\":\"Host listening\",\"id\":\"default\",\"status\":" << web::json(receiveAudio_.status().active ? "Active" : "Off") << "},";
    out << "{\"label\":\"Host microphone\",\"id\":\"default\",\"status\":" << web::json(microphoneAudio_.status().active ? "Active" : "Off") << "},";
    out << "{\"label\":\"Radio transmit\",\"id\":\"default\",\"status\":" << web::json(microphoneAudio_.status().active ? "Active" : "Off") << "}";
    out << "],\"routes\":[";
    out << "{\"name\":\"receive\",\"active\":" << boolean(receiveAudio_.status().active)
        << ",\"starting\":" << boolean(receiveAudio_.status().starting)
        << ",\"status\":" << web::json(receiveAudio_.status().active ? "Running" : "Off")
        << ",\"inputPeak\":" << receiveAudio_.status().inputPeak
        << ",\"outputPeak\":" << receiveAudio_.status().outputPeak << "},";
    out << "{\"name\":\"microphone\",\"active\":" << boolean(microphoneAudio_.status().active)
        << ",\"starting\":" << boolean(microphoneAudio_.status().starting)
        << ",\"status\":" << web::json(microphoneAudio_.status().active ? "Running" : "Off")
        << ",\"inputPeak\":" << microphoneAudio_.status().inputPeak
        << ",\"outputPeak\":" << microphoneAudio_.status().outputPeak << "}";
    out << "]},\"activity\":[";

    {
        std::lock_guard lock(activityMutex_);
        for (std::size_t i = 0; i < activity_.size(); ++i) {
            if (i) out << ',';
            out << web::json(activity_[i]);
        }
    }
    out << "],\"rf\":{\"running\":" << boolean(rfCapture_.running())
        << ",\"status\":" << web::json(toUtf8(rfCapture_.status()))
        << ",\"port\":" << web::json(rfCat2Port_)
        << ",\"baud\":" << rfCat2Baud_
        << ",\"span\":" << rfSpan_
        << ",\"level\":" << rfWaterfallLevelDb_
        << "}}";

    return out.str();
}

void ControllerMac::run() {
    while (running_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        publishWeb();
    }
}

void ControllerMac::shutdown() {
    if (!running_.exchange(false)) return;
    log("Shutting down FT-710 Dashboard on macOS...");
    releasePtt();
    receiveAudio_.stop();
    microphoneAudio_.stop();
    rfCapture_.stop();
    stopSharing();
    if (webServer_) webServer_->stop();
    if (worker_) worker_->stop();
}

}
