# H2 local PoC — Stufe 1, ausschließlich Entwicklungsmechanik

Lokaler Mechaniktest, keine Laufzeitqualifikation. Keine externe Quellenwahrheit;
keine Aussage über künftige Produktionsunterstützung. ES256 und PS256 bleiben
ungewählte technische Kandidaten. Keine Implementierungs-, Vertrags-, Betriebs-
oder Promotionsfreigabe für H2. C01–C11 samt Unterfällen bleiben NOT RUN;
F1 und D03 bleiben OPEN.

## Start und isolierte Abhängigkeiten

Im Worktree ausführen:

```sh
cd experiments/h2-local-poc
node run.mjs
```

`npm test` ist hier ausschließlich ein Alias für diesen lokalen Lauf. Keine
App-Skripte, Builds, Gesamtsuite oder Datenbank werden aufgerufen. Nach dem Lauf
gibt es weder automatische Netzwerkoperationen noch Cleanup-Aufrufe.

Falls die bereits installierte lokale Abhängigkeit später fehlt, ist vor einem
Lauf eine gesonderte Installation in genau diesem Verzeichnis möglich:

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache=./.npm-cache --userconfig=/dev/null
```

Das ist ein manueller Installationsbefehl, kein Bestandteil des Tests. Root-
package.json und Root-Lock bleiben unangetastet. `jose` ist ausschließlich hier
auf **6.2.14** gepinnt; package-lock.json bindet Registry-Artefakt und Integrität.
node_modules/ und .npm-cache/ sind nur innerhalb dieses Verzeichnisses ignoriert.
Beim Einrichten scheiterte der eingeschränkte Registry-Zugriff an DNS;
anschließend war der autorisierte Download erreichbar. Keine globale Installation.

Bereits vorhandenes **canonicalize 2.1.0** wird direkt aus
`../../node_modules/canonicalize/lib/canonicalize.js` eingebunden. Es wird weder
ersetzt noch neu installiert. Fehlt es, scheitert der Import; kein eigener JCS-
oder JWS-Ersatz. Ein handgeschriebenes synthetisches Canonical-Literal wird mit
der Serializer-Ausgabe verglichen; das ist keine vollständige Codec-Qualifikation.

## Tatsächlich verwendete Entwicklungsumgebung

Am 01.11.2026 lokal ermittelt: **Node v25.9.0**, **OpenSSL 3.6.3**,
**npm 11.12.1**, **darwin/arm64**. Diese Angaben bezeichnen nur die lokale
Entwicklungsruntime, keine gewählte Ziel- oder Produktionsruntime. Der Verifier
benötigt das hier verwendete Node-Permission-Modell; andere Runtime-Versionen
sind nicht geprüft.

## Ablauf und Daten

run.mjs bildet eine vollständig künstliche Payload mit PoC-Identitäten,
Platzhalter-Basis-Hash und zwei bloßen W2-Platzhalterreferenzen. Keine echten
Quellen, Claims, Captures oder Beobachtungen werden verwendet. Es gibt keinen
Netzabruf, R2-Readback, SQL, echte W2-Ausstellung oder H2-Authority-Prüfung.
Die Payload ist ausdrücklich kein beschlossenes H2-Schema.

Für jeden Lauf werden beide Schlüsselpaare neu im Speicher erzeugt. Private
CryptoKeys sind nicht exportierbar; nur öffentliche JWKs werden an den Verifier
übergeben. Private Schlüssel werden weder explizit gespeichert noch ausgegeben.
Sie leben bis zum Prozessende; eine sichere Speicherlöschung oder Schutz gegen
Betriebssystem-Swap/Dumps wird nicht behauptet. Keine Produktionsschlüssel,
Tokens, Zugangsdaten oder geheimen Konfigurationen werden verwendet.

- ES256: P-256/SHA-256; 64-Oktett-R||S-Signaturwert, Base64url im Compact-JWS.
- PS256: temporärer 2048-Bit-RSA-PSS-Testschlüssel als Profil-Untergrenze,
  SHA-256/MGF1-SHA-256 und Saltlänge 32 Byte; 256-Oktett-Signaturwert.
  jose 6.2.14 definiert PS256 als rsa(256, 32) in
  node_modules/jose/dist/webapi/lib/jws_algorithms.js; WebCrypto nutzt den
  Schlüsselhash. Zusätzlich prüft Node-crypto die Signatur mit explizitem PSS-
  Padding/Salt32 und lehnt Salt0 ab. Kein eigener Kryptografiealgorithmus.
- A1-Mechanik: JWS Compact mit eingebetteten JCS-UTF-8-Payloadbytes.
  alg, kid und typ stehen im geschützten Header. `poc-only-*`,
  `h2-local-poc-only+jws` und alle Payloadfelder sind nur Prototypwerte.
- Der Verifier hält pro Aufruf genau einen erwarteten Algorithmus/kid und
  öffentlichen Schlüssel fest; kein Algorithmus-Fallback oder Remote-Key-Lookup.
  Er prüft außerdem den erwarteten Payloadtext. Dies ist ein kleiner PoC-
  Prüfvertrag, kein vollständiger H2-Validator oder K1-Vertrauensanker.

verifier.mjs bietet keine Signier- oder Schreibschnittstelle. Der Runner startet
ihn als separaten Prozess mit nur den benötigten Lesefreigaben, ohne Datei-
Schreib-, Netzwerk- oder Subprozessfreigabe und ohne geerbte Umgebungsvariablen.
Er erhält ausschließlich öffentliche Schlüssel und synthetische JWS über stdin;
stdout enthält nur Prüfergebnisse. Der Test bestätigt fehlende Schreib-/
Netzwerkfreigabe. Das ist keine allgemeine Sicherheitsisolation gegenüber
dem lokalen Benutzer, Administrator oder kompromittierter Runtime.

Beide Prozesse verwenden jose und dieselbe Node/OpenSSL-Umgebung. Die zusätzliche
Node-crypto-Verifikation ist nur ein zweiter API-Weg. Weder Prozess-/Code-Trennung
noch diese Prüfung belegt administrative Unabhängigkeit, unabhängigen
Checkpoint-Erhalt oder Produktionsreife.

## Ausgeführte lokale Prüfungen und Ergebnisse

Vorgeschichte am 01.11.2026: erster Mechaniklauf 16/16, danach 19/19 mit
expliziter zweiter Format-/PSS-Prüfung. Diese früheren Negativtests prüften nur
die Ablehnung, nicht deren konkrete Ursache.

Am 02.11.2026 zunächst 23/23 nach Korrektur der Negativtest-Auswertung;
die beiden Prozess-Kontrollfälle prüften dabei noch einen Sammel-Exitcode.
Nach der folgenden Präzisierung abschließend **31/31**, Exitcode 0.
Die ursprünglichen Ablehnungsfälle prüfen Klasse und Code, der falsche
Signierschlüssel gezielt TypeError. Die Prozesskontrollen verlangen zusätzlich
einen geprüften Diagnosemarker und Exitstatus 42. Jeder Lauf erzeugt neue
private Testschlüssel nur im Speicher.

Der erste Lauf der strengeren Prozesskontrolle scheiterte beim alten PS256-
Importfall. Eine separate lokale Diagnose mit synthetischem öffentlichem JWK
zeigte: Ein leerer RSA-Exponent wurde beim Import zunächst akzeptiert und
erzwingt somit keinen Importfehler. Das war vom bisherigen Sammel-Exitcode
nicht erkennbar. Der Fall verwendet jetzt für beide Algorithmen einen
falschen JWK-ext-Typ, den jose 6.2.14 im Importpfad als TypeError abweist.
Diese Diagnose ist nicht zusätzlich in der Zählung 31 enthalten.

| Fall | ES256 | PS256 |
| --- | --- | --- |
| Unveränderte eingebettete Payload / gültige Signatur | akzeptiert | akzeptiert |
| Ein verändertes Signaturoktett | JWSSignatureVerificationFailed / ERR_JWS_SIGNATURE_VERIFICATION_FAILED | ebenso |
| Ein verändertes Payloadoktett, Signatur unverändert | JWSSignatureVerificationFailed / ERR_JWS_SIGNATURE_VERIFICATION_FAILED | ebenso |
| Gültige Signatur mit unbekanntem kid | PrototypeRejection / UNKNOWN_KID | ebenso |
| Verifier erhält falschen öffentlichen Schlüsseltyp | PrototypeRejection / KEY_PROFILE | ebenso |
| Gültige Signatur des jeweils anderen Algorithmus | JOSEAlgNotAllowed / ERR_JOSE_ALG_NOT_ALLOWED | ebenso |
| Signieraufruf mit falscher Algorithmus-/Schlüssel-Kombination | TypeError, ohne code/cause | ebenso |
| Importfehler bei falschem JWK-ext-Typ | POC_CONTROL_IMPORT_TYPE_ERROR_V1, Exit 42 | ebenso |
| Signaturfehler bei absichtlich falscher Erwartung UNKNOWN_KID | POC_CONTROL_SIGNATURE_FAILURE_RETHROWN_V1, Exit 42 | ebenso |
| Eingebettete Literalbytes, Signaturlänge, öffentlicher Verifier ohne Schreib-/Netzwerkfreigabe | bestätigt | bestätigt |
| Zweite öffentliche Node-API: SHA-256 und explizites Signaturformat | bestätigt (P1363) | bestätigt (PSS/Salt32) |
| Prüfung derselben PSS-Signatur mit Salt0 | nicht anwendbar | abgewiesen |

Die erwartete Ablehnung ist reine Test-Metadaten neben der Verifier-Anfrage,
kein signiertes Feld und kein H2-Fehlerprofil. Nur passende Fehlerklasse und
Code werden als erwartete Ablehnung zurückgegeben. Alle anderen Ausnahmen,
einschließlich von jose gekapselter WebCrypto-Ursachen, werden aus der
Einzelprüfung weitergeworfen. Eine unerwartete Annahme eines Negativfalls
lässt sie ebenfalls scheitern. Es gibt keinen Vergleich fragiler
Fehlermeldungstexte.

Testdaten, Mutationen und die Signierinstanz für den falschen Schlüssel werden
außerhalb der Ablehnungs-Catches erzeugt. Die unbekannte-kid- und andere-
Algorithmus-Kontrollsignatur werden zuvor mit ihrem passenden öffentlichen
Schlüssel positiv geprüft. Der falsche Signierschlüssel ist vor dem gezielten
TypeError-Test als privater Schlüssel des jeweils anderen Algorithmus geprüft.
Die vier echten Prozesskontrollen (zwei pro Algorithmus) prüfen Folgendes:

- Importkontrolle: Nur eine unmittelbar um importJWK gesetzte ImportFailure-
  Hülle mit ursprünglichem TypeError (exakte Klasse, kein code/cause) darf den
  Marker POC_CONTROL_IMPORT_TYPE_ERROR_V1 auslösen. Das absichtlich ungültige
  ext-Feld und die Test-Erwartung KEY_PROFILE werden vor dem Catch geprüft.
- Ursachen-Kontrolle: Nur der aus der Einzelprüfung weitergeworfene
  JWSSignatureVerificationFailed mit ERR_JWS_SIGNATURE_VERIFICATION_FAILED
  und ohne cause bei Erwartung UNKNOWN_KID darf den Marker
  POC_CONTROL_SIGNATURE_FAILURE_RETHROWN_V1 auslösen.

Erst nach diesen Prüfungen schreibt der Kontroll-Harness genau eine Markerzeile
und setzt Exitstatus 42. Der Elternprozess verlangt exakt diese vollständige
Ausgabe, Status 42, kein Signal, keinen Spawn-/Streamfehler und leeres stderr.
Fehlende, falsche, zusätzliche oder doppelte Marker und jeder andere Status
lassen den Test scheitern. Normale Prüfungen verlangen dagegen Exitstatus 0
und ein JSON-Ergebnis. Sonstige Verifier-Ausnahmen enden mit Status 1 und
einer festen datenarmen FAIL-Diagnose; Rohmeldungen und Stacks werden unterdrückt.

Acht zusätzliche Prüfungen der Prozessauswertung verwenden synthetische
Ergebnisdatensätze: fehlender/falscher/doppelter Marker, falscher Kontrollstatus,
Signalabbruch, Spawnfehler, Streamfehler und sonstiger Exitstatus. Sie prüfen
die Klassifikation, ohne echte Prozesse absichtlich zu signalisieren oder
Startfehler zu erzeugen. Zusammen mit den 23 bisherigen Prüfpositionen ergeben
sie 31. Die vier echten Prozesskontrollen belegen nur die hier konstruierten
Fehlerpfade in dieser lokalen Runtime. Daraus folgt keine vollständige
Abdeckung beliebiger Betriebssystemfehler, Sicherheitsisolation oder
unabhängige Laufzeitqualifikation.

Die Ausgabe enthält nur Fallnamen und PASS/FAIL, keine Schlüssel oder vollständigen
Payload-/Signaturwerte. Die lokale Zählung schließt zusammengefasste Assertions
ein; sie entspricht nicht den Owner-Vektoren C01–C11.

## Getrennter synthetischer Paketexport

Der normale `node run.mjs`-Lauf bleibt unverändert. Nur dieser ausdrückliche
Befehl erzeugt ein Paket, ausgehend vom Prototyp-Verzeichnis:

```sh
node export-package.mjs --export
```

Ohne --export scheitert der Befehl vor der Erzeugung von Schlüsseln oder Dateien.
Unter exports/ entsteht ein neues Verzeichnis mit UTC-Zeit und Zufalls-UUID.
mkdir ohne recursive für das Paket und Schreibzugriffe mit wx verhindern
Überschreiben. Ein fehlgeschlagener Export kann ein unvollständiges Verzeichnis
zurücklassen; es erfolgt keine automatische Bereinigung.

Enthalten sind ausschließlich sechs synthetische/öffentliche Datendateien und
deren Hashmanifest sha256.json: payload.json (JCS ohne angehängten Zeilenumbruch),
ES256.jws und PS256.jws (die originalen unveränderten Compact-JWS), je eine
öffentliche JWK-Datei sowie results.json mit Erzeugungs-Prüfergebnissen.
Das Manifest bindet die sechs Dateien, nicht sich selbst. Sein separat
ausgegebener SHA-256 bindet seine exakten Bytes, wenn der Empfänger diesen Wert
über eine geeignete unabhängige Quelle erhält. Es gibt keinen Archiv-Gesamthash.
Alle IDs, der Basis-Hash und W2-Referenzen sind künstliche Platzhalter.
Dies ist kein vollständiges H2-/W2-Schema oder echter Erfassungsnachweis.

Für jeden Export entstehen neue nicht exportierbare private Testschlüssel nur
im Speicher; ausschließlich öffentliche Schlüssel gelangen zur Serialisierung.
Schlüssel und vollständige Token werden nicht auf stdout ausgegeben. Die
exportierten JWS sind ausdrücklich öffentliche synthetische Signaturnachweise,
keine Zugangstokens. Keine Produktionsschlüssel, Quellen oder Claims.

Paketprüfung separat starten; den ausgegebenen EXPORT-Pfad einsetzen:

```sh
node --permission --allow-fs-read=. --allow-fs-read=../../node_modules/canonicalize verify-package.mjs 'exports/VERZEICHNIS-AUS-EXPORT'
```

verify-package.mjs importiert den Erzeuger nicht und hat keine Signier- oder
Schreibfunktion. Es liest ausschließlich die exakt erwarteten sieben Dateien
(keine Symlinks), berechnet ihre Hashes neu und prüft beide Signaturen mit
öffentlichen Schlüsseln, fester Algorithmus-Allowlist, PoC-Headern, Signaturlänge,
JCS und exakter Payloadbindung. results.json wird als Metadatum geprüft, nicht
als Ersatz dieser erneuten Verifikation. Node muss Schreib- und Netzwerkzugriff
verweigern; das Programm prüft diese Berechtigungsgrenzen selbst.

Die Negativprüfungen verändern ausschließlich Kopien im Speicher: JWS-Payload,
Signatur und separate Payload für beide Algorithmen sowie eine Paketdatei gegen
das unveränderte Hashmanifest. Nur konkrete JOSE-Fehlerklassen/-codes ohne
gekapselte Ursache beziehungsweise die festen Hash-/Bindungsfehler zählen als
erwartete Ablehnung. Setupfehler scheitern außerhalb dieser Prüfungen. Auf Platte
bleiben die Originale erhalten. Veränderte Dateien werden bei späterer Prüfung
am Manifest erkannt; ein mitverändertes Manifest ersetzt keine gültige Signatur.

Am 02.11.2026 ausgeführt: normaler Lauf 31/31, ausdrücklicher Export sieben
Dateien, separater Paketprüfer 10/10; jeweils Exitcode 0. Die Paketprüfungen
sind eine eigene Zählung, keine Erweiterung von C01–C11.

Die Prüfung ist vom Erzeugungsprogramm getrennt, nutzt aber dieselbe lokale
Node-/jose-/canonicalize-Umgebung. Sie belegt Dateikonsistenz und gültige
Signaturen relativ zu den mitgelieferten öffentlichen Schlüsseln; keine
authentifizierte externe Ausstelleridentität. Ein vollständiger Austausch von
Paket, Schlüsseln und Manifest ist ohne extern gebundenen Prüfanker nicht
erkennbar. Keine administrative Unabhängigkeit, Checkpoint-Verwahrung,
Quellenwahrheit, R2-Qualifikation oder Produktionsunterstützung. ES256/PS256
bleiben ungewählt; C01–C11 NOT RUN; F1/D03 OPEN.

## Dokumentation und Quellenbindung (bestehender Prototyp)

Vor Implementierung gelesen: Owner-Datei §§1.3–1.12,
SHA-256 `c310c15c7204023d7184525b1a5b467bafc35342d2cee1b4538dfc480e2b8701`.
FactBase-Ausstellerrolle, I1/W2, Modell C, S2/N1/H2, DF1/A1/K1/L1, F2 Option A,
Retention/METADATA_HASH_ONLY, B/U3 und Reference außerhalb von H bleiben
unverändert. Fragmentherkunft und Reader-/Canonical-Parität bleiben offen.

Verwendete offizielle API-Dokumentation (01.11.2026 gelesen):

- [CompactSign, jose v6.2.14](https://github.com/panva/jose/blob/v6.2.14/docs/jws/compact/sign/classes/CompactSign.md)
- [compactVerify, jose v6.2.14](https://github.com/panva/jose/blob/v6.2.14/docs/jws/compact/verify/functions/compactVerify.md)
- [generateKeyPair, offizielle Dokumentation](https://github.com/panva/jose/blob/main/docs/key/generate_key_pair/functions/generateKeyPair.md)

Webdarstellungen sind nicht lokal rohdateigehasht; der letzte Link ist veränderlich.
Die tatsächlich installierten Parameter wurden zusätzlich im lokalen Paket
gelesen. Bestehender JCS-Quelltext SHA-256:
`8a22f6848f00747463146fbfb11619944fc5800cf8f1ff0dfb9eb6489a05fe21`.
Keine Aussage über externe Quellenherkunft, zukünftige Verfügbarkeit, Speicher-
Dauerhaftigkeit, produktive Consumer oder historische Vollständigkeit.
