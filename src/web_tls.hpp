#pragma once
#include "net_compat.hpp"
#include <string>
#include <vector>

#if defined(_WIN32)
#ifndef SECURITY_WIN32
#define SECURITY_WIN32
#endif
#include <security.h>
#include <schannel.h>
#include <wincrypt.h>
#else
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#endif

namespace web {
std::string randomToken();
std::vector<std::string> hostAddresses();
std::string base64(const void* data, unsigned size);
std::string websocketAccept(const std::string& key);

class Credentials {
public:
    ~Credentials();
    void create(const std::wstring& folder);
    std::string certificate, fingerprint, appleProfile;

#if defined(_WIN32)
    CredHandle handle{};
private:
    bool ready_ = false;
    PCCERT_CONTEXT leaf_ = nullptr, root_ = nullptr;
#else
    SSL_CTX* ctx = nullptr;
private:
    bool ready_ = false;
#endif
};

class Stream {
public:
    explicit Stream(socket_t socket);
    ~Stream();
    bool negotiate(Credentials& credentials);
    bool secure() const { return secure_; }
    const std::string& error() const { return error_; }
    bool send(const std::string& data);
    int read(std::string& data, int timeoutMs); // -1 closed, 0 timeout, 1 data.

private:
    socket_t socket_;
    bool secure_ = false;
    std::string error_;

#if defined(_WIN32)
    CtxtHandle context_{};
    SecPkgContext_StreamSizes sizes_{};
    bool contextReady_ = false;
    std::string encrypted_;
    bool rawSend(const char* data, unsigned size);
    int receive(int timeoutMs);
#else
    SSL* ssl_ = nullptr;
    bool rawSend(const char* data, unsigned size);
#endif
};

}
