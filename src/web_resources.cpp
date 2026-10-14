#include "web_resources.hpp"
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <iostream>

#if defined(_WIN32)
#include <windows.h>
#endif

namespace web {
namespace {
std::string gWebRoot;

std::string readFile(const std::filesystem::path& p) {
    if (!std::filesystem::exists(p)) return "";
    std::ifstream file(p, std::ios::binary);
    if (!file) return "";
    std::ostringstream ss;
    ss << file.rdbuf();
    return ss.str();
}

std::string relativePathFor(unsigned id) {
    switch (id) {
        case 201: return "index.html";
        case 202: return "app.css";
        case 203: return "app.js";
        case 204: return "audio-worklet.js";
        case 205: return "audio-playback.js";
        case 207: return "control-core.js";
        case 210: return "wizard.html";
        default: return "";
    }
}
}

void setWebRoot(const std::string& path) {
    gWebRoot = path;
}

std::string resource(unsigned id) {
    std::string rel = relativePathFor(id);
    if (!rel.empty()) {
        std::vector<std::filesystem::path> candidates;
        if (!gWebRoot.empty()) {
            candidates.push_back(std::filesystem::path(gWebRoot) / rel);
        }
        candidates.push_back(std::filesystem::path("web") / rel);
        candidates.push_back(std::filesystem::path("../web") / rel);
        candidates.push_back(std::filesystem::path("../../web") / rel);

        for (const auto& path : candidates) {
            std::string content = readFile(path);
            if (!content.empty()) return content;
        }
    }

#if defined(_WIN32)
    auto module = GetModuleHandleW(nullptr);
    auto item = FindResourceW(module, MAKEINTRESOURCEW(id), RT_RCDATA);
    if (item) {
        auto loaded = LoadResource(module, item);
        return {static_cast<const char*>(LockResource(loaded)), SizeofResource(module, item)};
    }
#endif

    throw std::runtime_error("Web resource " + std::to_string(id) + " (" + rel + ") not found on disk or resources.");
}

}
