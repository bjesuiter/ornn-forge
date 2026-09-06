# Vulkanschmiede

Vulkanschmiede ist eine ruhige Werkstatt aus grauem Vulkanstein und warmem
Metall. Ornns glühende Schmiede bildet den Blickfang. Die eigentliche Arbeit
findet auf gut unterscheidbaren, mitteldunklen Flächen statt.

Es gelten die [gemeinsamen Designregeln](core-design.md).

## Charakter

Massiv, warm und geordnet. Breite horizontale Flächen erinnern an eine Werkbank.
Kupfer markiert Aktionen und Fortschritt. Feuer bleibt überwiegend im Artwork;
der Arbeitsbereich selbst glüht nicht. Das Theme eignet sich für eine dauerhaft
geöffnete Job-Übersicht mit direktem Zugriff auf den Runner.

## Palette

| CSS-Token         | Material          | Wert      | Verwendung                                  |
| ----------------- | ----------------- | --------- | ------------------------------------------- |
| `--bg`            | Vulkanstein       | `#30343b` | Seitenhintergrund und Navigation            |
| `--surface`       | Eisen             | `#3c424a` | Karten, Selects und aktive Navigation       |
| `--surface-hover` | Gebürstetes Eisen | `#494f58` | Hover auf Zeilen und Karten                 |
| `--text`          | Helles Metall     | `#fff5e7` | Überschriften und primärer Text             |
| `--muted`         | Helle Asche       | `#d1cec9` | Beschreibung und Metadaten                  |
| `--line`          | Steinkante        | `#626972` | Gliederung und Kartenränder                 |
| `--accent`        | Kupferglut        | `#efac79` | Primäre Aktion, Fokus und aktive Navigation |
| `--accent-ink`    | Dunkles Kupfer    | `#271b14` | Text auf gefüllten Akzentbuttons            |

„In Arbeit“ verwendet Kupfer `#efac79`, „Erfolgreich“ und „Verbunden“ das
entsättigte Grün `#a4c3ae`. „Wartet“ verwendet den Metadatenton. Die Statuswörter
stehen immer neben dem Farbpunkt.

Die Palette ist absichtlich heller als schwarzer Basalt. Die Hintergrundfarbe
liegt bei `#30343b`; für Arbeitsflächen keine fast schwarzen Ersatzwerte nutzen.
Auch Grenzen und Metadaten müssen beim weiteren Ausbau sichtbar bleiben.

Berechnete Kontraste: Haupttext auf Hintergrund 11,59:1, Metadaten auf Karten
6,46:1, Metadaten auf Hover-Flächen 5,26:1 und Buttontext auf Kupfer 8,66:1.

## Aufbau

```text
Seitennavigation | Breites Schmiedebild mit Einstieg
                 | Kennzahlen                 | Runner
                 | Job-Liste                  |
```

Die Seitennavigation ist auf großen Displays 220 px breit. Der Hauptbereich
beginnt mit einem leichten Navigationspfad. Darunter steht ein breites Bildband;
dessen linke Hälfte trägt Überschrift, Kurztext und „Jobs ansehen“.
Kennzahlen und Job-Liste bilden die breite Arbeitsspalte, der Runner die
schmale Ergänzung. Unter 1180 px wandert die Runner-Karte unter die Liste.

## Bild und Schrift

Asset: `/images/ornn/forge.jpg`. Ornn, Amboss und Glut bleiben rechts sichtbar.
Ein Verlauf in Vulkanstein schützt den Text links. Auf Mobilgeräten steht
der Text unten und der Verlauf läuft von unten nach oben. Dunkle Schatten
im Originalbild dürfen bleiben; sie bestimmen nicht die Farbe der UI-Flächen.

Cormorant Garamond trägt die große Überschrift, DM Sans die Arbeitsinhalte
und Kennzahlen. Der Einstieg „Die Schmiede ist erwacht.“ darf groß sein;
Job-Titel bleiben sachlich und direkt.

## Formen und Interaktion

Kleine Radien von 4–8 px, gerade Trennlinien und großzügige Zeilenabstände.
Die aktive Navigation erhält eine hellere Eisenfläche plus kupferfarbenen Text.
Job-Zeilen werden bei Hover flächig heller. Primäre Buttons sind kupferfarben;
sekundäre Aktionen bleiben Textbuttons. Keine zusätzlichen Glutrahmen.

## Mobile und Grenzen

Bis 850 px steht die Navigation horizontal, bis 600 px der gesamte Inhalt in
einer Spalte. Das Schmiedebild wird höher zugeschnitten, damit Ornn oberhalb
des Texts erkennbar bleibt. Job-Metadaten und Status dürfen umbrechen.

Vermeiden: schwarze Arbeitsflächen, grauer Text mit geringer Deckkraft,
orangefarbene Vollflächen hinter Listen oder Metalltexturen unter Text.
