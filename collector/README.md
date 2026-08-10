# Der Trace-Collector

Nimmt die technischen Fahrtprotokolle der Fahrerseite entgegen, legt sie 30 Tage
lang ab und zeigt sie an. Kein Framework, keine Abhängigkeiten, keine Datenbank —
Node und vier Dateien.

Live: **https://frunky.clemenshelm.com** · Ansicht unter `/` (Passwort), Aufnahme
unter `POST /api/v1/trace`, Löschung unter `DELETE /api/v1/trace/<id>`.

## Warum das so gebaut ist, wie es gebaut ist

Alles, was dieser Dienst verspricht, ist ein Versprechen über etwas, das er
**nicht** tut. Solche Zusagen sind aus dem Quelltext schwer zu glauben, also
prüft `test/collector.test.mjs` sie gegen die Bytes, die tatsächlich auf der
Platte landen, statt gegen die Absicht des Handlers: Man schickt einen Trace mit
Koordinaten, Stacktrace, Browserkennung, Cookie und zwei weitergereichten
IP-Adressen — und durchsucht danach die Dateien nach allen davon.

**Eine Datei pro Tag statt einer Datenbank.** Das Versprechen, auf das es
ankommt, ist die Aufbewahrungsfrist, und mit einer Tagesdatei ist Löschen ein
`unlink`. Niemand muss ein `DELETE` ausführen, nichts bleibt in einem Index oder
einem WAL zurück, und „ist es wirklich weg?" beantwortet ein Blick ins
Verzeichnis statt ein Vertrauensvorschuss. Der zweite Grund: Wenn nachts um drei
in einem Auto etwas schiefgeht, sollte das Beweismaterial greppbar sein.

**Ein Schema, nicht zwei.** `collector/schema.mjs` lädt `../trace-schema.js` —
dieselben Bytes, die auch der Browser lädt. Zwei Listen driften auseinander, und
ein abgedrifteter serverseitiger Filter lässt genau die Felder durch, die der
Client längst nicht mehr sendet. Das `eval` eines Browser-IIFE ist der Preis
dafür, dass es nur eine Definition gibt, und er ist billiger als die Fehlerklasse,
die er beseitigt.

**Die Ratenbegrenzung behält keine Identität.** Die Adresse wird mit einem
Geheimnis gehasht, das der Prozess beim Start erfindet und stündlich ersetzt; die
Zählung steht nur im Arbeitsspeicher. Der Zähler kann „derselbe Absender, diese
Stunde" unterscheiden und niemandem sagen, wer das war — auch uns nicht, auch
nicht aus einem Speicherabbild eine Stunde später.

**Ein Trace, der zweimal ankommt, ersetzt sich selbst.** Der Client wiederholt
einen fehlgeschlagenen Versand, und eine verlorene Antwort ist von einem
verlorenen Versand nicht zu unterscheiden. Ohne Ersetzung wäre jede schlechte
Verbindung ein Duplikat.

## Betrieb

```bash
# lokal
npm run collector                     # Port 8099, Ablage collector/data

# mit eigener Konfiguration
TRACE_PORT=8099 TRACE_DIR=/tmp/traces TRACE_ORIGINS="http://localhost:8080" \
TRACE_VIEW_USER=frunky TRACE_VIEW_PASS=geheim node collector/server.mjs
```

| Variable                | Vorgabe                             | Bedeutung                                           |
| ----------------------- | ----------------------------------- | --------------------------------------------------- |
| `TRACE_PORT`            | `8099`                              | Port                                                 |
| `TRACE_HOST`            | `0.0.0.0`                           | Bind-Adresse                                         |
| `TRACE_DIR`             | `collector/data`                    | Ablageverzeichnis                                    |
| `TRACE_RETENTION_DAYS`  | `30`                                | Aufbewahrung; danach wird die Tagesdatei gelöscht    |
| `TRACE_ORIGINS`         | `https://clemenshelm.github.io`     | erlaubte Herkünfte, kommagetrennt                    |
| `TRACE_MAX_BODY`        | `262144`                            | maximale Anfragegrösse in Bytes                      |
| `TRACE_RATE_PER_MINUTE` | `120`                               | Anfragen je Absender und Minute                      |
| `TRACE_VIEW_USER/PASS`  | leer                                | Zugang zur Ansicht; **leer heisst offen**            |

## Auf dem Server

Läuft auf der Helmcraft-Web-Box (`ssh websites`, Hetzner, Rechenzentrum
Helsinki) als Compose-Dienst neben Caddy und Umami. Kein Image-Bau und keine
Registry: Der Quelltext ist schreibgeschützt aus `/opt/frunky-trace` in ein
`node:22-alpine` eingehängt, die Daten liegen im Volume `web-infra_frunky_traces`.

```bash
collector/deploy/deploy.sh            # rsync + Neustart, das ist der ganze Vorgang
ssh websites 'cd /opt/web-infra && docker compose logs -f frunky-trace'
```

Der Dienst und der Caddy-Block stehen in `~/projects/web-infra`
(`docker-compose.yml`, `Caddyfile`); Kopien der beiden Ausschnitte liegen in
`deploy/` daneben. Die Zugangsdaten für die Ansicht stehen in
`/opt/web-infra/.env` (`FRUNKY_VIEW_USER`, `FRUNKY_VIEW_PASS`).

**Der Caddy-Block importiert `security_headers` absichtlich nicht.** Dieser
Ausschnitt *setzt* `X-Frame-Options: SAMEORIGIN`, und ein vom Proxy gesetzter
Header ersetzt den, den die Anwendung geschickt hat — das `DENY` der Ansicht
wäre stillschweigend abgeschwächt worden. Der Block führt dieselbe Liste ohne
diesen einen Header. Nachgeprüft wird das an der fertigen URL, nicht am Handler.

## Was der Collector nicht kann

- **Keine Zusammenführung mehrerer Fahrten.** Es gibt bewusst keine Kennung, über
  die zwei Fahrten demselben Gerät zuzuordnen wären. Fragen wie „scheitert dieses
  eine Auto immer?" sind damit nicht beantwortbar — das ist der Preis, und er ist
  eingepreist.
- **Keine Aggregatauswertung.** Die Ansicht listet Fahrten und zeichnet eine
  Fahrt. Für „wie oft friert der Tesla-Browser gegenüber iOS ein" gibt es
  `GET /api/v1/traces` und ein beliebiges Skript.
- **Kein Backup.** 30 Tage Diagnosedaten sind kein Bestand, den es zu sichern
  lohnt, und ein Backup wäre eine zweite Kopie, die die Aufbewahrungsfrist
  aushebelt.
