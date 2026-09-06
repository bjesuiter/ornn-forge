# Gemeinsame Designregeln

Ornn Forge ist die private Werkstatt eines Operators. Das Dashboard beantwortet:
Welche Jobs laufen, was wartet und welche Ergebnisse kann ich ansehen?
Übersicht, wenige wiederkehrende Bedienelemente und großzügige Abstände haben
Vorrang vor Fantasy-Dekoration.

Diese Regeln gelten für alle drei Themes. Farbwerte, Bildkomposition und
Raumaufteilung stehen in den jeweiligen Theme-Dateien:

- [Vulkanschmiede](vulkanschmiede.md)
- [Halle des Donners](halle-des-donners.md)
- [Ahnenholz](ahnenholz.md)

## Gemeinsame Bildsprache

Ornns Handwerkswelt liefert Material und Form: Stein, Metall, Hammer,
Hörner und die sorgfältige Herstellung eines Werks. Fantasy entsteht über
einen charakteristischen Bildbereich, zurückhaltende Serifenschrift und
wenige Materialfarben. Leseflächen bleiben ruhig und ohne Texturen.

Ein Bildschirm hat einen visuellen Schwerpunkt. Es gibt keine zusätzlichen
Runenrahmen um jede Karte, Partikeleffekte, permanenten Glühlichter oder
Animationen hinter Arbeitsinhalten. Bilder geben Atmosphäre; sie vermitteln
keine Betriebszustände.

## Die UI besteht aus vier wiederkehrenden Konzepten

1. Navigation: vier beschriftete Ziele für Übersicht, Jobs, Artifacts und
   Runner. Aktive Ziele erhalten Fläche oder Unterstreichung sowie `aria-current`.
2. Listen: ein Job pro Zeile mit Titel, Repository, Issue, Flow und Status.
   Die gesamte Zeile öffnet seine Details. Statusfilter bleiben direkt bei der Liste.
3. Inhaltsflächen: Runner, Artifacts und Details benutzen dieselbe Hierarchie
   aus Überschrift, Inhalt und optionaler Aktion. Kein weiteres Kartensystem
   für jede Unterseite.
4. Aktionen: ein gefüllter primärer Button pro Inhaltsbereich, Textbuttons
   für weitere Aktionen und native Selects für Design und Status.

Kennzahlen sind eine kompakte Zusammenfassung, kein eigener Navigationsmechanismus.
Die zugrunde liegende Information muss auch in Listen und Details auffindbar sein.

## Inhalt und Begriffe

Die Begriffe aus [CONTEXT.md](../../CONTEXT.md) gelten auch im Dashboard.
Insbesondere sind Job, Flow, Runner und Artifact unterschiedliche Dinge.
Navigation und Aktionen verwenden immer dieselben Bezeichnungen.

Ein erfolgreicher Job beweist keinen erfolgreichen Cleanup. Details zeigen
Ausführung und Cleanup getrennt. Der Runner weist belegte Capacity reservations
einschließlich ausstehendem Cleanup aus. Status hat immer einen Text; Farbe
und Symbol ergänzen ihn nur.

Das Designstudio verwendet bewusst identische, als „Beispieldaten“ bezeichnete
Inhalte für alle Themes. Navigation, Filter und Details funktionieren, lösen
aber keine Betriebsaktionen aus. Abmelden verwendet die echte Dashboard session.
Neue Live-Ansichten müssen Beispieldaten und echte Daten eindeutig unterscheiden.

## Typografie

| Rolle                  | Schrift                                                             | Anwendung                                                   |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Große Überschrift      | Cormorant Garamond, Gewicht 500                                     | Ein charakteristischer Einstieg pro Übersicht               |
| Navigation und Inhalte | DM Sans, Gewicht 400–600                                            | Listen, Beschreibungen, Buttons und Details                 |
| Kennzahlen             | DM Sans in Vulkanschmiede, Cormorant Garamond in den anderen Themes | Wenige Zahlen mit ausgeschriebenem Bezug                    |
| Kleine Kennzeichnung   | DM Sans, gesperrt                                                   | Kurze Material- oder Abschnittslabels, keine längeren Texte |

Der gemeinsame Basissatz ist 14 px bei Zeilenhöhe 1,5. Beschreibungstexte
verwenden 1,8. Große Überschriften skalieren abhängig vom Theme etwa zwischen
42 und 78 px; Abschnittsüberschriften liegen bei 19–21 px. Die bestehende
Vorschau verwendet für Metadaten 10–12 px und für Bildnachweise 8–9 px.
Wesentliche Anweisungen gehören in den normalen Lesetext, niemals in diese
kleinen Beschriftungen. Bei neuen Bedienelementen sind mindestens 12 px vorzusehen.

Die Schriften kommen aktuell über Google Fonts. Georgia und Sans-Serif-Systemschriften
sind die Fallbacks. Keine Information darf von einem erfolgreichen Font-Download abhängen.

## Abstände und Responsive-Verhalten

Als Raster dienen 4, 8, 12, 16, 24, 32 und 48 px. Das aktuelle Layout enthält
zusätzliche optische Anpassungen. Neue Komponenten orientieren sich zuerst
an diesem Raster. Karten erhalten ungefähr 24 px Innenabstand; größere
Inhaltsgruppen 24–48 px Abstand. Zeilen haben ausreichende vertikale Klickfläche
und dürfen bei schmaler Breite umbrechen.

Die Umsetzung passt sich bei 1180, 850 und 600 px an. Bis 850 px wird aus der
Seitennavigation eine horizontale, beschriftete Navigation. Bis 600 px stehen
Bild und Arbeitsinhalte untereinander. Einspaltige Ansichten müssen bis 320 px
ohne horizontales Scrollen funktionieren. Auf großen Monitoren begrenzt eine
maximale Inhaltsbreite die Zeilenlängen.

## Helligkeit und Lesbarkeit

Vulkanschmiede und Ahnenholz sind mitteldunkle Themes. Ihre Arbeitsflächen
sollen auch bei Tageslicht und auf Monitoren mit schwacher Schattendarstellung
unterscheidbar bleiben. Nahezu schwarze Hintergründe und lediglich minimal
hellere Karten sind für diese Themes nicht vorgesehen.

- Hintergrund, Karte und Hover-Fläche haben jeweils einen eigenen, erkennbaren Ton.
- Sekundärer Text ist vollständig deckend. Er wird nicht durch reduzierte
  Deckkraft über einem wechselnden Hintergrund abgedunkelt.
- Für normalen Text gilt ein Kontrastziel von mindestens 4,5:1 auf seiner
  tatsächlich sichtbaren Fläche, auch bei Hover und Auswahl.
- Trennlinien gliedern Inhalte zusätzlich zu Abstand und Überschriften.
  Ein wichtiger Zustand darf nicht nur an einer feinen Linie erkennbar sein.
- Text über Artwork braucht eine schützende Farbfläche oder einen Verlauf.
  Seine Lesbarkeit wird für jeden Bildausschnitt separat geprüft.
- Fokus ist ein sichtbarer, 2 px breiter Akzentrahmen mit 5 px Abstand.
  Status, Auswahl und Fehler bleiben ohne Farbwahrnehmung verständlich.

Die Kontrastwerte in den Theme-Dateien sind aus den sRGB-Farbwerten berechnete
Verhältnisse für deckende Flächen. Sie sind keine Messung eines realen Monitors
und keine Garantie für sämtliche Texte über Bildern.

## Implementierung und Prüfung

`src/components/forge-designs.tsx` enthält die gemeinsamen Ansichten und
Beispieldaten. `src/components/dashboard-placeholder.tsx` enthält den schlichten
Dashboard-Platzhalter. `src/components/forge-designs.css` enthält die Tokens und
Layoutvarianten. `.fd` definiert die Vulkanschmiede als Basis; `.fd-hall` und
`.fd-grove` überschreiben deren Farben und Layout.

`/dashboard/examples?design=forge`, `hall` oder `grove` wählen das Theme. Unbekannte
Werte fallen auf `forge` zurück. Das Menü ändert die URL, ohne die gewählte
Inhaltsansicht zurückzusetzen. Nach einem Neuladen bleibt das Theme erhalten;
Ansicht und Filter sind lokaler Zustand. Der Login-Schutz liegt in der gemeinsamen `/dashboard`-Elternroute und gilt
für den Platzhalter und alle Beispiele. `/dashboard` selbst zeigt ausschließlich
einen Platzhalter im Vulkanschmiede-Theme, mit Link zu `/dashboard/examples`.

Bei Designänderungen Desktop, 320–390 px und die relevanten Zwischenbreiten
prüfen. Textkontrast, Bildausschnitt, Umbruch, Fokus und klickbare Zeilen sind
wichtiger als zusätzliche Tests für unveränderte Framework-Funktionen.
Die aktuelle Gestaltung benötigt keine Animationen.

## Quellen und Assets

Bild- und Textgrundlage, gesichtet am 6. September 2026:

- [Offizielle Ornn-Seite von Riot Games](https://www.leagueoflegends.com/de-de/champions/ornn/)
- [Ornn](https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ornn_0.jpg)
- [Donnerfürst Ornn](https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ornn_1.jpg)
- [Ahnenholz-Ornn](https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ornn_2.jpg)

`public/images/ornn/` enthält unveränderte lokale Kopien der Riot-Artworks für
die Designbeispiele. Die Ausschnitte und Verläufe entstehen per CSS. Copyright:
Riot Games. Der Footer jedes Themes verlinkt die Quelle.
