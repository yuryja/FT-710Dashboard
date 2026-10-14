# FT-710 Dashboard pour macOS · Contrôle à Distance pour Yaesu FT-710
**Porté et Développé pour macOS par** : Yury Jajitzky (**YY3BIG**)  
**Basé sur** : [FT-710 Dashboard pour Windows par M0NXD](https://github.com/M0NXD/FT-710Dashboard)  
**Licence** : [Apache License 2.0](LICENSE) (Consultez [NOTICE](NOTICE) et [DISCLAIMER.md](DISCLAIMER.md))

---

🌐 **Languages / Idiomas / Langues / Línguas / Lingue**:  
[English](README_EN.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Português](README_PT.md) | [Italiano](README_IT.md)

---

> [!CAUTION]
> **AVERTISSEMENT LOGICIEL EXPÉRIMENTAL POUR RADIOAMATEURS**  
> Ce logiciel est strictement expérimental et distribué selon les principes du Service Radioamateur. L'**Opérateur de Contrôle** (*Control Operator*) demeure à tout moment le seul et unique responsable légal du fonctionnement technique, de la puissance d'émission RF, du respect des limites des bandes de fréquences, du taux d'ondes stationnaires (TOS / SWR) et de l'activation du PTT de sa station. Pour les essais initiaux, utilisez impérativement une **charge fictive (Dummy Load)** de 50 Ω. Consultez les conditions légales complètes dans [DISCLAIMER.md](DISCLAIMER.md).

---

## 🌟 Fonctionnalités sous macOS

* **Compilation Native Apple Silicon & Intel** : Code C++20 optimisé pour macOS (`arm64` et `x86_64`) avec Apple Clang.
* **Contrôle CAT Intégral** : Contrôle bidirectionnel des VFO A et B, modes opératoires, filtres, gains RF/AF, vu-mètres de transmission/réception, DNR, NB et paramètres du Yaesu FT-710 via Hamlib 4.7.2.
* **Détection Automatique des Ports USB** : Analyse et connexion automatique au transmetteur sur `/dev/cu.SLAB_USBtoUART*` ou `/dev/cu.usbserial*`.
* **Serveur NET rigctl Partagé (Port 4532)** : Permet aux applications radio sous Mac (telles que **WSJT-X**, **JS8Call**, **fldigi**, **MacLoggerDX**, **RUMlogNG**) de partager simultanément le port CAT avec le transceiver.
* **Audio Bidirectionnel à Faible Latence (CoreAudio)** : Intégration transparente avec la carte son interne du FT-710 (`USB Audio CODEC`) via PortAudio et Apple CoreAudio natif.
* **Serveur Web et Mobile HTTPS (Port 8888)** : Contrôle à distance complet et streaming audio depuis tout iPhone, iPad, Mac ou navigateur web sur votre réseau local.
* **Spectre Audio et Chute d'Eau (Waterfall) en Temps Réel** : FFT Hann de 4096 points fluide en JavaScript/WebGL à 60 ips.
* **Support RF Scope FTDI FT4222H** : Capture du spectre RF haute vitesse via USB-SPI lorsque **SCU-LAN10 = ON** est activé sur le FT-710.

---

## 🚀 Installation et Compilation sous macOS

### 1. Prérequis (Homebrew)
Installez les dépendances nécessaires via Homebrew :
```bash
brew install cmake hamlib portaudio openssl@3
```

### 2. Compilation
Depuis la racine du dépôt :
```bash
cmake -B build-mac -S .
cmake --build build-mac
```

L'exécutable généré sera disponible à l'emplacement : `build-mac/FT710Dashboard-macOS`.

---

## 📡 Utilisation et Exécution

### Mode Démo (Sans émetteur-récepteur connecté)
Pour explorer l'interface et tester le système sans brancher le transmetteur :
```bash
./build-mac/FT710Dashboard-macOS --demo
```

### Connexion au Yaesu FT-710
1. Connectez le câble USB à l'arrière du FT-710 sur votre Mac.
2. Allumez le poste et lancez :
```bash
./build-mac/FT710Dashboard-macOS
```
Le système détectera automatiquement le port série. Pour spécifier un port ou une vitesse manuellement :
```bash
./build-mac/FT710Dashboard-macOS --port /dev/cu.SLAB_USBtoUART --baud 38400
```

### Options en Ligne de Commande
```text
  --demo            Exécute en mode simulation avec le backend Hamlib Dummy
  --port <chemin>   Chemin du port série Enhanced CAT-1 (ex: /dev/cu.SLAB_USBtoUART)
  --baud <vitesse>  Vitesse en bauds de CAT (par défaut: 38400)
  --passcode <code> Code d'accès fixe pour le tableau de bord web
  --no-browser      Ne pas ouvrir automatiquement le navigateur au démarrage
  --help, -h        Affiche ce message d'aide
```

---

## 📱 Accès Web et Audio Téléphonique sur iPhone / iPad

1. Lors du démarrage du serveur, ouvrez dans Safari : `http://localhost:8888/setup` (ou remplacez `localhost` par l'adresse IP locale de votre Mac).
2. Téléchargez le profil de configuration et installez-le dans iOS (**Réglages &rarr; Profil téléchargé &rarr; Installer**).
3. Activez la confiance complète du certificat dans iOS (**Réglages &rarr; Général &rarr; Informations &rarr; Réglages des certificats de confiance &rarr; Activer la confiance pour M0NXD / YY3BIG**).
4. Ouvrez `https://<ip-de-votre-mac>:8888/` pour bénéficier du contrôle à distance complet et de l'audio bidirectionnel sur votre téléphone.

---

## ⚖️ Licence et Attribution

Ce projet est distribué sous licence **Apache License 2.0**.
Conformément à la section 4(d) de la licence :
* Toute redistribution, modification ou projet dérivé (fork) **DOIT conserver le fichier `NOTICE`** et attribuer explicitement le crédit à :  
  **"Yury Jajitzky (YY3BIG) - FT-710 Dashboard for macOS"**
* Projet original sous Windows développé par **M0NXD** (https://github.com/M0NXD/FT-710Dashboard).
