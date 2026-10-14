# FT-710 Dashboard per macOS · Controllo Remoto per Yaesu FT-710
**Adattato e Sviluppato per macOS da**: Yury Jajitzky (**YY3BIG**)  
**Basato su**: [FT-710 Dashboard per Windows di M0NXD](https://github.com/M0NXD/FT-710Dashboard)  
**Licenza**: [Apache License 2.0](LICENSE) (Vedi [NOTICE](NOTICE) e [DISCLAIMER.md](DISCLAIMER.md))

---

**Languages / Idiomas / Langues / Línguas / Lingue**:  
[English](README_EN.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Português](README_PT.md) | [Italiano](README_IT.md)

---

> [!CAUTION]
> **AVVISO SOFTWARE SPERIMENTALE PER RADIOAMATORI**  
> Questo software è strettamente sperimentale e distribuito secondo i principi del Servizio di Radioamatore. L'**Operatore di Controllo** (*Control Operator*) è in ogni momento il solo ed esclusivo responsabile legale del funzionamento tecnico, della potenza RF emessa, dei limiti di banda di frequenza autorizzati, del rapporto di onde stazionarie (ROS / SWR) e delle trasmissioni PTT della propria stazione. Per i test iniziali, utilizzare sempre un **carico fittizio (Dummy Load)** da 50 Ω. Consultare i termini legali completi in [DISCLAIMER.md](DISCLAIMER.md).

---

## Caratteristiche su macOS

* **Compilazione Nativa Apple Silicon & Intel**: Codice C++20 ottimizzato per macOS (`arm64` e `x86_64`) con Apple Clang.
* **Controllo CAT Completo**: Controllo bidirezionale di VFO A e B, modalità operative, filtri, guadagni RF/AF, indicatori di ricezione/trasmissione, DNR, NB e parametri dello Yaesu FT-710 tramite Hamlib 4.7.2.
* **Rilevamento Automatico Porte USB**: Scansione e connessione automatica al ricetrasmettitore su `/dev/cu.SLAB_USBtoUART*` o `/dev/cu.usbserial*`.
* **Server NET rigctl Condiviso (Porta 4532)**: Consente ai software per radioamatori su Mac (come **WSJT-X**, **JS8Call**, **fldigi**, **MacLoggerDX**, **RUMlogNG**) di condividere simultaneamente la porta CAT con la radio.
* **Audio Bidirezionale a Bassa Latenza (CoreAudio)**: Integrazione diretta con la scheda audio interna dell'FT-710 (`USB Audio CODEC`) tramite PortAudio e CoreAudio nativo di Apple.
* **Server Web e Mobile HTTPS (Porta 8888)**: Controllo remoto completo e streaming audio da qualsiasi iPhone, iPad, Mac o browser Web nella rete locale.
* **Spettro Audio e Cascata (Waterfall) in Tempo Reale**: FFT Hann a 4096 punti fluida in JavaScript/WebGL a 60 fps.
* **Supporto RF Scope FTDI FT4222H**: Acquisizione ad alta velocità dello spettro RF via USB-SPI abilitando l'opzione **SCU-LAN10 = ON** sull'FT-710.

---

## Installazione e Compilazione su macOS

### 1. Prerequisiti (Homebrew)
Installare le dipendenze necessarie tramite Homebrew:
```bash
brew install cmake hamlib portaudio openssl@3
```

### 2. Compilazione
Dalla cartella principale del repository:
```bash
cmake -B build-mac -S .
cmake --build build-mac
```

L'eseguibile generato sarà posizionato in: `build-mac/FT710Dashboard-macOS`.

---

## Utilizzo ed Esecuzione

### Modalità Demo (Senza radio fisica collegata)
Per esplorare l'interfaccia e testare le funzionalità senza connettere il ricetrasmettitore:
```bash
./build-mac/FT710Dashboard-macOS --demo
```

### Connessione allo Yaesu FT-710
1. Collegare il cavo USB posteriore dell'FT-710 al Mac.
2. Accendere la radio ed eseguire:
```bash
./build-mac/FT710Dashboard-macOS
```
Il programma rileverà automaticamente la porta seriale. Per forzare manualmente una porta o una velocità in baud:
```bash
./build-mac/FT710Dashboard-macOS --port /dev/cu.SLAB_USBtoUART --baud 38400
```

### Opzioni da Riga di Comando
```text
  --demo            Esegue in modalità simulazione con backend Hamlib Dummy
  --port <percorso> Percorso porta seriale Enhanced CAT-1 (es: /dev/cu.SLAB_USBtoUART)
  --baud <velocità> Velocità in baud CAT (predefinita: 38400)
  --passcode <cod>  Password fissa di accesso al pannello web
  --no-browser      Non apre automaticamente il browser all'avvio
  --help, -h        Mostra questo messaggio di aiuto
```

---

## Accesso Web e Audio su iPhone / iPad

1. All'avvio del server, aprire in Safari: `http://localhost:8888/setup` (o sostituire `localhost` con l'indirizzo IP locale del Mac).
2. Scaricare il profilo di configurazione e installarlo in iOS (**Impostazioni &rarr; Profilo scaricato &rarr; Installa**).
3. Attivare l'attendibilità del certificato in iOS (**Impostazioni &rarr; Generali &rarr; Info &rarr; Impostazioni attendibilità certificati &rarr; Abilita piena attendibilità per M0NXD / YY3BIG**).
4. Aprire `https://<ip-del-tuo-mac>:8888/` per il controllo remoto completo e l'audio bidirezionale direttamente dallo smartphone.

---

## Licenza e Attribuzione

Questo progetto è distribuito sotto licenza **Apache License 2.0**.
Ai sensi della Sezione 4(d) della licenza:
* Qualsiasi ridistribuzione, modifica o fork **DEVE conservare il file `NOTICE`** e attribuire esplicita menzione a:  
  **"Yury Jajitzky (YY3BIG) - FT-710 Dashboard for macOS"**
* Progetto originale per Windows sviluppato da **M0NXD** (https://github.com/M0NXD/FT-710Dashboard).
