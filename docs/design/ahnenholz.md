# Ahnenholz

Ahnenholz ist ein Atelier in einem lichten, alten Wald. Ein hohes Bildfenster
steht neben den Arbeitsinhalten. Moosgrüne Flächen, helles Laub und ein kleiner
Blütenakzent geben dem Theme einen weichen, organischen Charakter.

Es gelten die [gemeinsamen Designregeln](core-design.md).

## Charakter

Ruhig, lebendig und etwas verspielter als die beiden anderen Themes. Große
Bögen erinnern an Ornns Hörner und alte Baumkronen. Die Arbeitsflächen sind
hell genug abgestuft, um nicht in einem dunklen Waldhintergrund zu verschwinden.
Das Theme eignet sich für eine persönliche Werkstatt, deren Bild und aktuelle
Arbeit nebeneinander sichtbar sind.

## Palette

| CSS-Token         | Material          | Wert      | Verwendung                                  |
| ----------------- | ----------------- | --------- | ------------------------------------------- |
| `--bg`            | Waldstein         | `#293f3d` | Seitenhintergrund und Navigation            |
| `--surface`       | Moos              | `#36514b` | Karten, Selects und aktive Navigation       |
| `--surface-hover` | Salbeiblatt       | `#426058` | Hover-Flächen                               |
| `--text`          | Helles Laub       | `#f1f5e9` | Haupttext und Überschriften                 |
| `--muted`         | Silbergrünes Laub | `#cdded3` | Metadaten und Beschreibung                  |
| `--line`          | Helle Rinde       | `#6b887d` | Gliederung und Kartenränder                 |
| `--accent`        | Flechte           | `#d3e7ae` | Primäre Aktion, aktive Navigation und Fokus |
| `--accent-ink`    | Dunkles Blatt     | `#25382d` | Text auf gefüllten Buttons                  |

„In Arbeit“ verwendet Blütenlicht `#ddbcdf`. „Erfolgreich“ und „Verbunden“
verwenden Grün `#a4c3ae`; „Wartet“ den Metadatenton. Die kleine Materialzeile
setzt mit `#cbb0cc` einen weiteren Blütenakzent. Violett ist kein zweiter
primärer Aktionsstil.

Die Flächen bleiben mitteldunkles Grün. Tiefschwarzes Petrol ist kein Ersatz
für den Hintergrund. Moosflächen müssen sich auch ohne Schatten klar von der
Seite abheben. Sekundäre Texte sind helles, deckendes Silbergrün.

Berechnete Kontraste: Haupttext auf Hintergrund 10,13:1, Metadaten auf Karten
6,15:1, Metadaten auf Hover-Flächen 4,92:1 und Buttontext auf Flechte 9,40:1.

## Aufbau

```text
Schmale Navigation | Hohes Bildfenster | Kennzahlen
                   |                  | Job-Liste
                   | Einstieg unten   | Breite Runner-Karte
```

Die Navigation ist am Desktop 104 px breit und kombiniert Symbole mit
Beschriftungen. Das Bildfenster belegt etwa zwei Fünftel des Hauptbereichs;
der Rest gehört der Arbeit. Kennzahlen stehen über der Liste, der Runner
als breite Karte darunter. Dadurch steht die Arbeit bereits neben dem
Einstieg und muss nicht erst unter einem breiten Hero gesucht werden.

## Bild und Schrift

Asset: `/images/ornn/elderwood.jpg`. Der hohe Ausschnitt betont Ornns Gesicht,
leuchtende Blätter und Holzstruktur. Oben bildet ein Radius von 160 px den
Bogen; unten schließen kleine Radien von 16 px das Fenster ab. Ein Verlauf
in Waldstein schützt den Text am unteren Rand.

Cormorant Garamond trägt Einstieg und Kennzahlen, DM Sans die Arbeitsinhalte.
„Hier wächst dein nächstes Werk.“ darf abhängig vom Platz auf mehrere kurze
Zeilen umbrechen. Die Liste bleibt von dieser bildhaften Sprache unabhängig.

## Formen und Interaktion

Weiche Radien von 12–16 px für Navigation und Karten, pillenförmiger
Primärbutton mit 30 px Radius. Die Liste ist offen und verzichtet am Desktop
auf die zusätzlichen Job-Symbole der anderen Themes. Trennlinien und Status
reichen für die Orientierung.

Die aktive Navigation bekommt eine Moosfläche und hellen Flechtentext. Hover
hellt die gesamte Zeile auf. Kein Pulsieren, keine schwebenden Blätter und
keine Runentexturen unter Arbeitsinhalten.

## Mobile und Grenzen

Bis 850 px wird die Navigation horizontal. Bis 600 px steht das Bildfenster
über Kennzahlen, Liste und Runner. Sein oberer Radius reduziert sich auf
140 px, der Einstieg auf etwa 47 px Schriftgröße. Der obere Bildausschnitt
bleibt sichtbar; der Text erhält am unteren Rand genügend Hintergrunddeckung.

Vermeiden: nahezu schwarze Waldflächen, neongrüne Bedienelemente, transparente
Karten auf detailreichen Bildern und violette Flächen hinter längeren Texten.
