# EXPERIMENTAL AMATEUR RADIO SOFTWARE NOTICE & DISCLAIMER OF LIABILITY
### FT-710 Dashboard for macOS
**Ported & Developed for macOS by**: Yury Jajitzky (**YY3BIG**)  
**Based on**: FT-710 Dashboard by M0NXD (https://github.com/M0NXD/FT-710Dashboard)  
**License**: Apache License 2.0  

---

**Languages / Idiomas / Langues / Línguas / Lingue**:  
[English](#english) · [Español](#español) · [Français](#français) · [Português](#português) · [Italiano](#italiano)

---

<a name="english"></a>
## English · Amateur Radio Safety Notice & Legal Disclaimer

> [!CAUTION]
> **PLEASE READ CAREFULLY BEFORE USING THIS SOFTWARE.**  
> By compiling, running, or using this software, you expressly, voluntarily, and irrevocably agree to all terms, conditions, and safety notices stated herein.

### 1. Experimental Nature & Amateur Radio Principles
This software is an **experimental open-source tool** developed solely for educational, technical study, and radio experimentation purposes under the spirit of the **Amateur Radio Service** (ITU Radio Regulations, IARU guidelines, and applicable national regulatory frameworks).

### 2. Sole and Exclusive Responsibility of the Control Operator
In accordance with international telecommunications and amateur radio regulations:
1. The **Station Control Operator** is at all times solely and exclusively legally responsible for the technical operation, signal purity, RF power level, and safety of their station.
2. The Control Operator must:
   * Verify that transmitting frequencies fall strictly within the authorized amateur frequency allocations and license privileges.
   * Continuously monitor and regulate RF output power and Standing Wave Ratio (SWR).
   * Actively supervise all Push-To-Talk (PTT) transmissions to prevent unintended, continuous, or unmonitored carrier activation.
   * Ensure that antennas, coaxial feeders, baluns, and matching networks are properly matched and rated.
   * Enable the Time-Out Timer (TOT) on the Yaesu FT-710 transceiver.

### 3. Total Disclaimer of Liability for Damages (No Warranty)
Under no circumstances and under no legal theory (contract, tort, strict liability, or negligence) shall the author of this macOS port (**Yury Jajitzky, YY3BIG**), the author of the original base project (**M0NXD**), or any contributor be liable to you or any third party for:
* **Direct, indirect, special, incidental, punitive, or consequential damages** arising from the use, misuse, or inability to use this software.
* **Damage to Radio Transceivers**: Damage to Yaesu FT-710 transceivers, including blown final RF power transistors (PA), low-pass filter modules, switching relays, or internal automatic antenna tuners.
* **Damage to Computer Hardware**: Damage to Mac USB ports, audio interfaces, FTDI/Silicon Labs bridge chips, or connected peripherals.
* **Regulatory Infractions**: Fines, sanctions, license suspensions, or complaints resulting from out-of-band emissions, excessive RF power, spurious emissions, or harmonics.

### 4. Mandatory Safety Standards for Initial Testing
1. **Use of a 50 Ω Dummy Load**: Perform all initial tests (PTT actuation, band changing, mode selection, audio loopback) with the transceiver connected to a calibrated 50 Ω dummy load adequate for the transmitter power.
2. **Supervised Operation Only**: NEVER operate this software unattended while transmission or CAT PTT functionality is active.
3. **Emergency Disconnect**: Always remain in close physical proximity to the radio power switch or DC power supply disconnect.

**IF YOU DO NOT AGREE TO THESE CONDITIONS OR CANNOT ASSUME FULL LEGAL RESPONSIBILITY FOR YOUR STATION, DO NOT COMPILE OR USE THIS SOFTWARE.**

---

<a name="español"></a>
## Español · Aviso de Software Experimental y Exención Total de Responsabilidad

> [!CAUTION]
> **LEA DETENIDAMENTE ANTES DE UTILIZAR ESTE SOFTWARE.**  
> Al compilar, ejecutar o utilizar este software, usted acepta de manera expresa, voluntaria e irrevocable todos los términos, condiciones y advertencias aquí estipulados.

### 1. Naturaleza Experimental y Principios de la Radioafición
Este software es una herramienta **experimental de código abierto** desarrollada con fines estrictamente educativos, de estudio técnico y de experimentación en telecomunicaciones, bajo el espíritu tradicional del **Servicio de Radioaficionados** (Reglamento de Radiocomunicaciones de la UIT, normativas IARU y legislaciones nacionales aplicables).

### 2. Responsabilidad Exclusiva e Indelegable del Operador de Control
De conformidad con los reglamentos internacionales de telecomunicaciones:
1. El **Operador de Control de la Estación** de radioaficionado es en todo momento el **ÚNICO Y EXCLUSIVO RESPONSABLE LEGAL** del funcionamiento técnico, operativo y de seguridad de su estación.
2. Es obligación exclusiva del operador:
   * Verificar que la frecuencia de operación esté dentro de los segmentos de banda autorizados para su categoría.
   * Vigilar y controlar la potencia de salida de radiofrecuencia (RF) y la relación de onda estacionaria (ROE / SWR).
   * Monitorear activamente cualquier ciclo de transmisión (PTT) para evitar transmisiones accidentales, continuas o no deseadas.
   * Asegurar el correcto funcionamiento del sistema de antenas, cables coaxiales, acopladores y cargas.
   * Configurar en el transceptor Yaesu FT-710 los límites de tiempo de transmisión (TOT - Time-Out Timer).

### 3. Exención Total de Responsabilidad por Daños (Sin Garantía)
Bajo ninguna circunstancia y bajo ninguna teoría legal (contractual, extracontractual, negligencia o responsabilidad estricta), el autor de esta versión (**Yury Jajitzky, YY3BIG**), el autor del proyecto base original (**M0NXD**), ni ningún colaborador o distribuidor serán responsables ante usted ni ante terceros por:
* **Daños directos, indirectos, especiales, fortuitos, punitivos o consecuentes** derivados del uso, mal uso o imposibilidad de uso de este software.
* **Daño a equipos de radio**: Daños a transceptores Yaesu FT-710, rotura o quema de transistores de potencia finales (PA), filtros pasa-bajos, relés de conmutación o sintonizadores automáticos.
* **Daño a hardware informático**: Daños en puertos USB, interfaces de comunicación, chips de audio, chips FTDI o periféricos de la computadora Mac.
* **Infracciones regulatorias**: Sanciones administrativas, multas, pérdida de licencias o reclamos derivados de emisiones fuera de banda, exceso de potencia o emisiones no deseadas.

### 4. Normas de Seguridad Recomendadas para Pruebas
1. **Uso de Carga Ficticia (Dummy Load)**: Realice todas las pruebas iniciales de transmisión (PTT, cambio de bandas, sintonización) conectando el transceptor a una carga ficticia de 50 Ω adecuada a la potencia del equipo.
2. **Supervisión Continua**: NUNCA opere este software desatendido cuando la función de PTT o transmisión esté habilitada.
3. **Corte de Emergencia**: Conozca siempre el procedimiento para apagar inmediatamente el transceptor o desconectar el cable de alimentación en caso de anomalía.

**SI NO ESTÁ DE ACUERDO CON ESTAS CONDICIONES O NO DESEA ASUMIR LA RESPONSABILIDAD PLENA DE SU ESTACIÓN, NO COMPILE NI UTILICE ESTE SOFTWARE.**

---

<a name="français"></a>
## Français · Avis de Logiciel Expérimental et Clause de Non-Responsabilité

> [!CAUTION]
> **VEUILLEZ LIRE ATTENTIVEMENT AVANT D'UTILISER CE LOGICIEL.**  
> En compilant, exécutant ou utilisant ce logiciel, vous acceptez expressément et irrévocablement toutes les conditions et tous les avertissements énoncés ci-dessous.

### 1. Nature Expérimentale et Principes du Radioamateurisme
Ce logiciel est un outil **open source expérimental** conçu exclusivement à des fins éducatives, d'analyse technique et d'expérimentation radioélectrique, conformément aux principes du **Service Radioamateur** (Règlement des radiocommunications de l'UIT, normes IARU et réglementations nationales).

### 2. Responsabilité Exclusive de l'Opérateur de Contrôle
Conformément aux réglementations internationales :
1. L'**Opérateur de Contrôle de la Station** est à tout moment le **SEUL ET UNIQUE RESPONSABLE LÉGAL** du fonctionnement technique et de la sécurité de sa station.
2. L'opérateur est tenu de :
   * Vérifier que la fréquence d'émission se situe dans les bandes allouées à sa classe de licence.
   * Surveiller en permanence la puissance d'émission RF et le rapport d'ondes stationnaires (TOS / SWR).
   * Superviser tout déclenchement PTT pour prévenir toute émission accidentelle ou continue.
   * S'assurer de la conformité des antennes et des lignes d'alimentation.
   * Configurer le temporisateur de transmission (TOT - Time-Out Timer) sur le Yaesu FT-710.

### 3. Exonération Totale de Responsabilité
En aucun cas l'auteur de ce portage macOS (**Yury Jajitzky, YY3BIG**), l'auteur original (**M0NXD**) ou les contributeurs ne sauraient être tenus responsables de :
* Dommages directs ou indirects résultant de l'utilisation de ce logiciel.
* Dommages matériels causés au Yaesu FT-710 (transistors de puissance PA, filtres, relais, coupleur d'antenne).
* Dommages aux ports USB ou au matériel informatique du Mac.
* Infractions administratives relatives aux émissions hors bande ou à des puissances non conformes.

### 4. Consignes de Sécurité pour les Essais
1. **Charge Fictive 50 Ω** : Réaliser tous les essais initiaux de transmission sur une charge fictive 50 Ω adaptée.
2. **Supervision Continue** : Ne jamais laisser le logiciel fonctionner sans surveillance lorsque l'émission est active.
3. **Arrêt d'Urgence** : Savoir couper immédiatement l'alimentation du poste en cas d'anomalie.

---

<a name="português"></a>
## Português · Aviso de Software Experimental e Isenção de Responsabilidade

> [!CAUTION]
> **LEIA COM ATENÇÃO ANTES DE UTILIZAR ESTE SOFTWARE.**  
> Ao compilar, executar ou utilizar este software, você aceita de forma expressa e irrevogável todos os termos e condições aqui descritos.

### 1. Natureza Experimental e Princípios do Radioamadorismo
Este software é uma ferramenta **experimental de código aberto** desenvolvida com fins estritamente educacionais e de estudo técnico no âmbito do **Serviço de Radioamador** (Regulamento de Radiocomunicações da UIT, normativas IARU e legislação nacional).

### 2. Responsabilidade Exclusiva do Operador de Controle
De acordo com os regulamentos de telecomunicações:
1. O **Operador de Controle da Estação** é em todos os momentos o **ÚNICO E EXCLUSIVO RESPONSÁVEL LEGAL** pela operação técnica e de segurança da sua estação.
2. É obrigação do operador:
   * Assegurar que as frequências de transmissão estejam dentro das faixas autorizadas pela sua licença.
   * Monitorar a potência de saída de RF e a relação de ondas estacionárias (ROE / SWR).
   * Acompanhar os acionamentos de PTT evitando transmissões contínuas indesejadas.
   * Configurar o temporizador de transmissão (TOT) no Yaesu FT-710.

### 3. Isenção Total de Responsabilidade
Em nenhuma hipótese o autor deste porte para macOS (**Yury Jajitzky, YY3BIG**), o autor original (**M0NXD**) ou colaboradores serão responsáveis por:
* Danos diretos ou indiretos decorrentes do uso ou incapacidade de uso deste software.
* Danos ao transceptor Yaesu FT-710 (transistores de potência PA, filtros, relés, sintonizador interno).
* Danos a portas USB ou periféricos do Mac.
* Infrações regulatórias por emissão fora de faixa ou potência excessiva.

### 4. Normas de Segurança para Testes
1. **Carga Fictícia de 50 Ω**: Efetue os primeiros testes de PTT e sintonia conectado a uma carga fictícia de 50 Ω.
2. **Supervisão Contínua**: Nunca opere o software sem supervisão com transmissão habilitada.
3. **Desconexão de Emergência**: Esteja sempre pronto para desligar a fonte de alimentação em caso de anomalia.

---

<a name="italiano"></a>
## Italiano · Avviso di Software Sperimentale ed Esclusione di Responsabilità

> [!CAUTION]
> **LEGGERE ATTENTAMENTE PRIMA DI UTILIZZARE QUESTO SOFTWARE.**  
> Compilando, eseguendo o utilizzando questo software, si accettano espressamente e irrevocabilmente tutti i termini e le condizioni qui indicati.

### 1. Natura Sperimentale e Principi del Radioamatorismo
Questo software è uno strumento **open source sperimentale** sviluppato per scopi educativi e di sperimentazione tecnica nell'ambito del **Servizio di Radioamatore** (Regolamento delle Radiocomunicazioni UIT, IARU e normative nazionali).

### 2. Responsabilità Esclusiva dell'Operatore di Controllo
In conformità alle normative sulle telecomunicazioni:
1. L'**Operatore di Controllo della Stazione** è in ogni momento l'**UNICO ERETTO E RESPONSABILE LEGALE** del funzionamento tecnico e della sicurezza della propria stazione.
2. È obbligo dell'operatore:
   * Verificare che le frequenze di trasmissione siano rigorosamente all'interno delle bande autorizzate.
   * Monitorare costantemente la potenza RF e il rapporto di onde stazionarie (ROS / SWR).
   * Supervisionare l'attivazione del PTT per prevenire trasmissioni accidentali o continue.
   * Configurare il Time-Out Timer (TOT) sul ricetrasmettitore Yaesu FT-710.

### 3. Esclusione Totale di Responsabilità
In nessun caso l'autore di questo porting macOS (**Yury Jajitzky, YY3BIG**), l'autore del progetto originario (**M0NXD**) o altri collaboratori saranno responsabili per:
* Danni diretti o indiretti derivanti dall'uso o dall'impossibilità di usare questo software.
* Danni all'apparato Yaesu FT-710 (stadio finale PA, filtri passa-basso, relè, accordatore automatico).
* Danni a porte USB o hardware del Mac.
* Sanzioni o contestazioni per emissioni fuori banda o spurie.

### 4. Misure di Sicurezza Raccomandate
1. **Carico Fittizio da 50 Ω**: Condurre tutti i test preliminari collegando la radio a un carico fittizio da 50 Ω.
2. **Sorveglianza Continua**: Non utilizzare mai il software senza supervisione con la trasmissione abilitata.
3. **Disconnessione di Emergenza**: Mantenere sempre l'accesso rapido all'interruttore dell'alimentazione.
