#pragma once

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
using socket_t = SOCKET;
inline int close_socket(socket_t s) { return ::closesocket(s); }
inline int set_socket_timeout(socket_t s, int optname, int timeoutMs) {
    DWORD tv = static_cast<DWORD>(timeoutMs);
    return setsockopt(s, SOL_SOCKET, optname, reinterpret_cast<const char*>(&tv), sizeof(tv));
}
inline int socket_error_code() { return WSAGetLastError(); }
inline bool is_socket_timeout(int err) { return err == WSAETIMEDOUT; }
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/select.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <chrono>

using socket_t = int;
constexpr socket_t INVALID_SOCKET = -1;
constexpr int SOCKET_ERROR = -1;
inline int close_socket(socket_t s) { return ::close(s); }
inline int closesocket(socket_t s) { return ::close(s); }
inline int set_socket_timeout(socket_t s, int optname, int timeoutMs) {
    struct timeval tv{};
    tv.tv_sec = timeoutMs / 1000;
    tv.tv_usec = (timeoutMs % 1000) * 1000;
    return setsockopt(s, SOL_SOCKET, optname, &tv, sizeof(tv));
}
inline int socket_error_code() { return errno; }
inline bool is_socket_timeout(int err) { return err == EAGAIN || err == EWOULDBLOCK || err == ETIMEDOUT; }

#ifndef SD_BOTH
#define SD_BOTH SHUT_RDWR
#endif
#ifndef SO_EXCLUSIVEADDRUSE
#define SO_EXCLUSIVEADDRUSE SO_REUSEADDR
#endif

inline uint64_t GetTickCount64() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}
#endif
