#include "rf_scope.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <string>
#include <dlfcn.h>
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <iostream>

namespace rf_scope {
namespace {
constexpr std::array<std::uint32_t, 10> Spans{1000, 2000, 5000, 10000, 20000,
    50000, 100000, 200000, 500000, 1000000};
constexpr std::array<std::uint8_t, 4> SyncTail{0xFF, 0x01, 0xEE, 0x01};

using FtHandle = void*;
using FtStatus = std::uint32_t;
using FtOpenEx = FtStatus (*)(void*, std::uint32_t, FtHandle*);
using FtClose = FtStatus (*)(FtHandle);
using FtSetTimeouts = FtStatus (*)(FtHandle, std::uint32_t, std::uint32_t);
using FtSetLatencyTimer = FtStatus (*)(FtHandle, std::uint8_t);
using SpiMasterInit = std::uint32_t (*)(FtHandle, std::uint32_t, std::uint32_t, std::uint32_t, std::uint32_t, std::uint8_t);
using SetClock = std::uint32_t (*)(FtHandle, std::uint32_t);
using SpiSingleRead = std::uint32_t (*)(FtHandle, std::uint8_t*, std::uint16_t, std::uint16_t*, int);
using Uninitialize = std::uint32_t (*)(FtHandle);

template <typename T>
bool loadSymbol(void* handle, const char* name, T& fn) {
    void* sym = dlsym(handle, name);
    std::memcpy(&fn, &sym, sizeof(fn));
    return fn != nullptr;
}

struct FtdiMac {
    void* d2xx = nullptr;
    void* ft4222 = nullptr;
    FtOpenEx openEx = nullptr;
    FtClose close = nullptr;
    FtSetTimeouts setTimeouts = nullptr;
    FtSetLatencyTimer setLatencyTimer = nullptr;
    SpiMasterInit spiInit = nullptr;
    SetClock setClock = nullptr;
    SpiSingleRead read = nullptr;
    Uninitialize uninit = nullptr;
    FtHandle handle = nullptr;
    bool initialized = false;

    ~FtdiMac() {
        if (handle && initialized && uninit) uninit(handle);
        if (handle && close) close(handle);
        if (ft4222) dlclose(ft4222);
        if (d2xx) dlclose(d2xx);
    }

    bool load(std::wstring& error) {
        const char* d2xxCandidates[] = {
            "libftd2xx.dylib",
            "/usr/local/lib/libftd2xx.dylib",
            "/opt/homebrew/lib/libftd2xx.dylib",
            "runtime/ftdi/libftd2xx.dylib",
            nullptr
        };
        const char* ft4222Candidates[] = {
            "libft4222.dylib",
            "/usr/local/lib/libft4222.dylib",
            "/opt/homebrew/lib/libft4222.dylib",
            "runtime/ftdi/libft4222.dylib",
            nullptr
        };

        for (int i = 0; d2xxCandidates[i]; ++i) {
            d2xx = dlopen(d2xxCandidates[i], RTLD_LAZY | RTLD_LOCAL);
            if (d2xx) break;
        }
        if (!d2xx) {
            error = L"FTDI D2XX library (libftd2xx.dylib) not found on macOS. Install FTDI D2XX driver.";
            return false;
        }

        for (int i = 0; ft4222Candidates[i]; ++i) {
            ft4222 = dlopen(ft4222Candidates[i], RTLD_LAZY | RTLD_LOCAL);
            if (ft4222) break;
        }
        if (!ft4222) {
            error = L"FTDI FT4222 library (libft4222.dylib) not found on macOS. Install LibFT4222.";
            return false;
        }

        if (!loadSymbol(d2xx, "FT_OpenEx", openEx) ||
            !loadSymbol(d2xx, "FT_Close", close) ||
            !loadSymbol(d2xx, "FT_SetTimeouts", setTimeouts) ||
            !loadSymbol(d2xx, "FT_SetLatencyTimer", setLatencyTimer) ||
            !loadSymbol(ft4222, "FT4222_SPIMaster_Init", spiInit) ||
            !loadSymbol(ft4222, "FT4222_SetClock", setClock) ||
            !loadSymbol(ft4222, "FT4222_SPIMaster_SingleRead", read) ||
            !loadSymbol(ft4222, "FT4222_UnInitialize", uninit)) {
            error = L"Failed to load required symbols from FTDI libraries on macOS.";
            return false;
        }
        return true;
    }

    bool open(std::wstring& error) {
        char descA[] = "FT4222 A";
        char descGeneric[] = "FT4222";
        FtStatus status = openEx(descA, 2 /* OPEN_BY_DESCRIPTION */, &handle);
        if (status != 0 || !handle) {
            status = openEx(descGeneric, 2, &handle);
        }
        if (status != 0 || !handle) {
            error = L"Could not open FT4222 on USB. Ensure FT-710 menu SCU-LAN10 is ON.";
            return false;
        }

        setTimeouts(handle, 1000, 1000);
        setLatencyTimer(handle, 2);
        setClock(handle, 1 /* 24 MHz */);
        if (spiInit(handle, 1 /* Single */, 6 /* Div64 */, 1 /* IdleHigh */, 0 /* Leading */, 1 /* SS0 */) != 0) {
            error = L"Could not initialize FT4222 SPI master mode.";
            return false;
        }
        initialized = true;
        return true;
    }
};

bool decodeBcdFrequency(const std::uint8_t* raw, std::uint64_t& hz) {
    const std::uint8_t* p = raw + 2900;
    hz = 0;
    for (int i = 0; i < 4; ++i) {
        std::uint8_t b = p[i];
        unsigned hi = (b >> 4) & 0x0F;
        unsigned lo = b & 0x0F;
        if (hi > 9 || lo > 9) return false;
        hz = hz * 100 + hi * 10 + lo;
    }
    return true;
}

speed_t toBaud(unsigned b) {
    switch (b) {
        case 4800: return B4800;
        case 9600: return B9600;
        case 19200: return B19200;
        case 38400: return B38400;
        case 115200: return B115200;
        default: return B4800;
    }
}
}

std::uint32_t spanHz(unsigned spanIndex) {
    return spanIndex < Spans.size() ? Spans[spanIndex] : 0;
}

std::wstring spanLabel(unsigned spanIndex) {
    if (spanIndex >= Spans.size()) return L"Unknown span";
    auto value = Spans[spanIndex];
    if (value < 1000) return std::to_wstring(value) + L" Hz";
    if (value < 1000000) return std::to_wstring(value / 1000) + L" kHz";
    return L"1 MHz";
}

Capture::~Capture() {
    stop();
}

bool Capture::start() {
    stop();
    stopRequested_ = false;
    running_ = true;
    thread_ = std::thread([this] { run(); });
    return true;
}

void Capture::stop() {
    stopRequested_ = true;
    if (thread_.joinable()) thread_.join();
    running_ = false;
}

bool Capture::latest(Frame& frame) const {
    std::lock_guard lock(mutex_);
    frame = latest_;
    return frame.valid;
}

std::wstring Capture::status() const {
    std::lock_guard lock(mutex_);
    return status_;
}

void Capture::setStatus(std::wstring status) {
    std::lock_guard lock(mutex_);
    status_ = std::move(status);
}

void Capture::run() {
    std::wstring error;
    FtdiMac ftdi;
    if (!ftdi.load(error)) {
        setStatus(error);
        running_ = false;
        return;
    }
    if (!ftdi.open(error)) {
        setStatus(error);
        running_ = false;
        return;
    }

    setStatus(L"FT-710 RF scope capturing over USB-SPI");
    std::vector<std::uint8_t> raw(FrameBytes, 0);

    while (!stopRequested_.load()) {
        std::uint16_t bytesRead = 0;
        auto status = ftdi.read(ftdi.handle, raw.data(), static_cast<std::uint16_t>(raw.size()), &bytesRead, 1);
        if (status != 0 || bytesRead != FrameBytes) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            continue;
        }

        // Check sync tail
        if (std::memcmp(raw.data() + FrameBytes - 4, SyncTail.data(), 4) != 0) {
            continue;
        }

        Frame decoded{};
        for (std::size_t i = 0; i < BinCount; ++i) {
            decoded.bins[i] = static_cast<std::uint8_t>(~raw[i]);
        }
        decoded.spanIndex = raw[2900 + 32];
        decoded.frequencyValid = decodeBcdFrequency(raw.data(), decoded.centerHz);
        decoded.valid = decoded.spanIndex < Spans.size();

        if (decoded.valid) {
            std::lock_guard lock(mutex_);
            decoded.sequence = ++sequence_;
            decoded.generation = generation_;
            decoded.acquiredAt = GetTickCount64();
            latest_ = decoded;
            status_ = L"Live FT-710 RF scope · " + spanLabel(decoded.spanIndex) + L" · 850 bins";
        }
    }
    running_ = false;
}

std::wstring applySpan(const std::wstring& cat2Port, unsigned spanIndex, unsigned baudRate, double waterfallLevelDb) {
    if (spanIndex >= Spans.size()) return L"Select a supported FT-710 scope span";
    if (baudRate != 4800 && baudRate != 9600 && baudRate != 19200 && baudRate != 38400 && baudRate != 115200)
        return L"Select a supported CAT-2 baud rate";
    if (!std::isfinite(waterfallLevelDb) || waterfallLevelDb < -30.0 || waterfallLevelDb > 30.0)
        return L"Waterfall level must be between -30 and +30 dB";

    std::string port(cat2Port.begin(), cat2Port.end());
    if (port.empty()) return L"Select the radio Standard / CAT-2 serial port first";

    int fd = ::open(port.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd < 0) {
        return L"Could not open CAT-2 serial port: " + cat2Port;
    }

    struct termios tio{};
    if (tcgetattr(fd, &tio) != 0) {
        ::close(fd);
        return L"Failed to get serial attributes on " + cat2Port;
    }

    speed_t spd = toBaud(baudRate);
    cfsetispeed(&tio, spd);
    cfsetospeed(&tio, spd);

    tio.c_cflag &= ~PARENB;
    tio.c_cflag &= ~CSTOPB;
    tio.c_cflag &= ~CSIZE;
    tio.c_cflag |= CS8 | CLOCAL | CREAD;
    tio.c_iflag = IGNPAR;
    tio.c_oflag = 0;
    tio.c_lflag = 0;

    tcsetattr(fd, TCSANOW, &tio);

    // FT-710 CAT command: set CENTER mode and span (SCP01x;) and waterfall level
    // Format: SS01x; where x is span code
    char spanCmd[32];
    std::snprintf(spanCmd, sizeof(spanCmd), "SS01%02u;", spanIndex);
    ::write(fd, spanCmd, std::strlen(spanCmd));
    ::tcdrain(fd);

    ::close(fd);
    return L"Applied scope span " + spanLabel(spanIndex) + L" to FT-710";
}

}
