# FT-710 Dashboard para macOS · Controle Remoto para Yaesu FT-710
**Adaptado e Desenvolvido para macOS por**: Yury Jajitzky (**YY3BIG**)  
**Baseado em**: [FT-710 Dashboard para Windows por M0NXD](https://github.com/M0NXD/FT-710Dashboard)  
**Licença**: [Apache License 2.0](LICENSE) (Consulte [NOTICE](NOTICE) e [DISCLAIMER.md](DISCLAIMER.md))

---

🌐 **Languages / Idiomas / Langues / Línguas / Lingue**:  
[English](README_EN.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Português](README_PT.md) | [Italiano](README_IT.md)

---

> [!CAUTION]
> **AVISO DE SOFTWARE EXPERIMENTAL PARA RADIOAMADORES**  
> Este software é estritamente experimental e distribuído sob os princípios do Serviço de Radioamador. O **Operador de Controle** (*Control Operator*) é a todo momento o único e exclusivo responsável legal pela operação técnica, potência de RF, conformidade com os limites de faixa de frequência, relação de onda estacionária (ROE / SWR) e acionamento de transmissões PTT de sua estação. Para testes iniciais, utilize sempre uma **carga fantasma (Dummy Load)** de 50 Ω. Leia os termos legais completos em [DISCLAIMER.md](DISCLAIMER.md).

---

## 🌟 Recursos no macOS

* **Compilação Nativa Apple Silicon & Intel**: Código C++20 otimizado para macOS (`arm64` e `x86_64`) com Apple Clang.
* **Controle CAT Completo**: Controle bidirecional de VFO A e B, modos de operação, filtros, ganhos de RF/AF, medidores de TX/RX, DNR, NB e ajustes do Yaesu FT-710 via Hamlib 4.7.2.
* **Detecção Automática de Portas USB**: Varredura e conexão automática com o transceptor em `/dev/cu.SLAB_USBtoUART*` ou `/dev/cu.usbserial*`.
* **Servidor NET rigctl Compartilhado (Porta 4532)**: Permite que programas de rádio no Mac (como **WSJT-X**, **JS8Call**, **fldigi**, **MacLoggerDX**, **RUMlogNG**) compartilhem simultaneamente o controle CAT do rádio.
* **Áudio Bidirecional de Baixa Latência (CoreAudio)**: Integração com a placa de som interna do FT-710 (`USB Audio CODEC`) via PortAudio e Apple CoreAudio nativo.
* **Servidor Web e Móvel HTTPS (Porta 8888)**: Controle remoto e transmissão de áudio a partir de qualquer iPhone, iPad, Mac ou navegador web na sua rede local.
* **Espectro de Áudio e Cascata (Waterfall) em Tempo Real**: FFT Hann de 4096 pontos renderizado suavemente em JavaScript/WebGL a 60 fps.
* **Suporte ao RF Scope FTDI FT4222H**: Captura de espectro RF em alta velocidade via USB-SPI com a opção **SCU-LAN10 = ON** no FT-710.

---

## 🚀 Instalação e Compilação no macOS

### 1. Pré-requisitos (Homebrew)
Instale as dependências necessárias através do Homebrew:
```bash
brew install cmake hamlib portaudio openssl@3
```

### 2. Compilar
A partir da raiz do repositório:
```bash
cmake -B build-mac -S .
cmake --build build-mac
```

O binário executável gerado estará em: `build-mac/FT710Dashboard-macOS`.

---

## 📡 Uso e Operação

### Modo Demonstração (Sem rádio físico)
Para explorar a interface e testar recursos sem conectar o transceptor:
```bash
./build-mac/FT710Dashboard-macOS --demo
```

### Conexão ao Yaesu FT-710
1. Conecte o cabo USB traseiro do FT-710 ao seu Mac.
2. Ligue o rádio e execute:
```bash
./build-mac/FT710Dashboard-macOS
```
O sistema detectará automaticamente a porta serial. Para especificar uma porta ou taxa de transmissão manualmente:
```bash
./build-mac/FT710Dashboard-macOS --port /dev/cu.SLAB_USBtoUART --baud 38400
```

### Opções de Linha de Comando
```text
  --demo            Executa em modo simulação com backend Hamlib Dummy
  --port <caminho>  Caminho da porta serial Enhanced CAT-1 (ex: /dev/cu.SLAB_USBtoUART)
  --baud <taxa>     Velocidade em bauds de CAT (padrão: 38400)
  --passcode <cod>  Senha fixa de acesso ao painel web
  --no-browser      Não abre o navegador automaticamente ao iniciar
  --help, -h        Exibe esta mensagem de ajuda
```

---

## 📱 Acesso Web e Áudio no iPhone / iPad

1. Ao iniciar o servidor, abra no Safari: `http://localhost:8888/setup` (ou substitua `localhost` pelo endereço IP local do seu Mac).
2. Baixe o perfil de configuração e instale-o no iOS (**Ajustes &rarr; Perfil Baixado &rarr; Instalar**).
3. Habilite a confiança total do certificado no iOS (**Ajustes &rarr; Geral &rarr; Sobre &rarr; Ajustes de Confiança de Certificados &rarr; Habilitar confiança total para M0NXD / YY3BIG**).
4. Abra `https://<ip-do-seu-mac>:8888/` para controle remoto completo e áudio bidirecional direto do seu celular.

---

## ⚖️ Licença e Atribuição

Este projeto é distribuído sob a licença **Apache License 2.0**.
Em conformidade com a Seção 4(d) da licença:
* Qualquer redistribuição, modificação ou trabalho derivado (fork) **DEVE manter o arquivo `NOTICE`** e fornecer atribuição explícita a:  
  **"Yury Jajitzky (YY3BIG) - FT-710 Dashboard for macOS"**
* Projeto original para Windows desenvolvido por **M0NXD** (https://github.com/M0NXD/FT-710Dashboard).
