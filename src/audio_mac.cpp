#include "audio.hpp"
#include <portaudio.h>
#include <algorithm>
#include <cmath>
#include <codecvt>
#include <locale>
#include <iostream>

namespace audio {
namespace {
std::wstring toWide(const char* utf8) {
    if (!utf8) return L"";
    std::string s(utf8);
    return std::wstring(s.begin(), s.end());
}

std::string toUtf8(const std::wstring& w) {
    return std::string(w.begin(), w.end());
}

int parsePaIndex(const std::wstring& id) {
    if (id.starts_with(L"pa:")) {
        try {
            return std::stoi(id.substr(3));
        } catch (...) {}
    }
    return paNoDevice;
}
}

bool remoteSession() {
    return false;
}

std::wstring directDeviceIssue() {
    return L"";
}

std::vector<Device> directDevices() {
    return devices();
}

std::wstring savedDeviceName(const std::wstring& identity, bool input) {
    for (const auto& dev : devices()) {
        if (dev.input == input && dev.id == identity) return dev.name;
    }
    return L"";
}

std::vector<Device> devices() {
    std::vector<Device> list;
    if (Pa_Initialize() != paNoError) return list;

    int count = Pa_GetDeviceCount();
    for (int i = 0; i < count; ++i) {
        const PaDeviceInfo* info = Pa_GetDeviceInfo(i);
        if (!info) continue;

        if (info->maxInputChannels > 0) {
            Device dev;
            dev.id = L"pa:" + std::to_wstring(i);
            dev.name = toWide(info->name);
            dev.input = true;
            dev.direct = true;
            list.push_back(dev);
        }
        if (info->maxOutputChannels > 0) {
            Device dev;
            dev.id = L"pa:" + std::to_wstring(i);
            dev.name = toWide(info->name);
            dev.input = false;
            dev.direct = true;
            list.push_back(dev);
        }
    }
    return list;
}

Route::Route() {
    gain_ = 1.0f;
}

Route::~Route() {
    stop();
}

void Route::gate(bool enabled) {
    gate_.store(enabled);
}

void Route::gain(float value) {
    gain_.store(value);
}

Status Route::status() const {
    std::lock_guard lock(mutex_);
    return status_;
}

void Route::requestStop() {
    stopWanted_.store(true);
    stopCv_.notify_all();
}

void Route::stop() {
    requestStop();
    if (thread_.joinable()) {
        thread_.join();
    }
}

void Route::start(const std::wstring& source, const std::wstring& destination) {
    stop();
    stopWanted_.store(false);
    {
        std::lock_guard lock(mutex_);
        status_.starting = true;
        status_.active = false;
        status_.text = L"Starting...";
    }
    thread_ = std::thread([this, source, destination] {
        run(source, destination);
    });
}

void Route::run(std::wstring source, std::wstring destination) {
    if (Pa_Initialize() != paNoError) {
        std::lock_guard lock(mutex_);
        status_ = {false, false, 0, 0, L"PortAudio initialization failed"};
        return;
    }

    int inDev = parsePaIndex(source);
    int outDev = parsePaIndex(destination);

    if (inDev == paNoDevice && !source.empty()) inDev = Pa_GetDefaultInputDevice();
    if (outDev == paNoDevice && !destination.empty()) outDev = Pa_GetDefaultOutputDevice();

    PaStreamParameters inParams{};
    PaStreamParameters outParams{};

    bool hasIn = (inDev != paNoDevice);
    bool hasOut = (outDev != paNoDevice);

    if (hasIn) {
        inParams.device = inDev;
        inParams.channelCount = 1;
        inParams.sampleFormat = paFloat32;
        inParams.suggestedLatency = Pa_GetDeviceInfo(inDev)->defaultLowInputLatency;
        inParams.hostApiSpecificStreamInfo = nullptr;
    }

    if (hasOut) {
        outParams.device = outDev;
        outParams.channelCount = 1;
        outParams.sampleFormat = paFloat32;
        outParams.suggestedLatency = Pa_GetDeviceInfo(outDev)->defaultLowOutputLatency;
        outParams.hostApiSpecificStreamInfo = nullptr;
    }

    constexpr double sampleRate = 48000.0;
    constexpr unsigned long framesPerBuffer = 512;

    PaStream* stream = nullptr;
    PaError err = Pa_OpenStream(
        &stream,
        hasIn ? &inParams : nullptr,
        hasOut ? &outParams : nullptr,
        sampleRate,
        framesPerBuffer,
        paClipOff,
        nullptr,
        nullptr
    );

    if (err != paNoError || !stream) {
        std::lock_guard lock(mutex_);
        status_ = {false, false, 0, 0, L"Could not open audio stream: " + toWide(Pa_GetErrorText(err))};
        return;
    }

    if (receiveTap_) {
        spectrum_.configure(sampleRate);
        browserAudio().source(sampleRate);
    }

    if (Pa_StartStream(stream) != paNoError) {
        Pa_CloseStream(stream);
        std::lock_guard lock(mutex_);
        status_ = {false, false, 0, 0, L"Could not start audio stream"};
        return;
    }

    {
        std::lock_guard lock(mutex_);
        status_.active = true;
        status_.starting = false;
        status_.text = L"Running";
    }

    std::vector<float> inBuffer(framesPerBuffer, 0.0f);
    std::vector<float> outBuffer(framesPerBuffer, 0.0f);

    while (!stopWanted_.load()) {
        float peakIn = 0.0f;
        float peakOut = 0.0f;
        float curGain = gain_.load();

        if (hasIn) {
            err = Pa_ReadStream(stream, inBuffer.data(), framesPerBuffer);
            if (err == paNoError) {
                for (unsigned long i = 0; i < framesPerBuffer; ++i) {
                    float s = inBuffer[i];
                    float absS = std::abs(s);
                    if (absS > peakIn) peakIn = absS;

                    if (receiveTap_) {
                        spectrum_.push(s);
                        browserAudio().receive(s);
                    }

                    outBuffer[i] = s * curGain;
                }
            }
        }

        if (hasOut) {
            for (unsigned long i = 0; i < framesPerBuffer; ++i) {
                float s = outBuffer[i];
                float absS = std::abs(s);
                if (absS > peakOut) peakOut = absS;
            }
            Pa_WriteStream(stream, outBuffer.data(), framesPerBuffer);
        }

        {
            std::lock_guard lock(mutex_);
            status_.inputPeak = std::min(1.0f, peakIn);
            status_.outputPeak = std::min(1.0f, peakOut);
        }
    }

    Pa_StopStream(stream);
    Pa_CloseStream(stream);

    {
        std::lock_guard lock(mutex_);
        status_ = {false, false, 0, 0, L"Off"};
    }
}

void Route::runDirect(std::wstring source, std::wstring destination) {
    run(source, destination);
}

}
