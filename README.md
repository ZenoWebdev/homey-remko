# REMKO Smart-Control Touch voor Homey Pro

Lokale Homey-app voor een REMKO Smart-Control Touch warmtepomp. De app leest de gegevens via de MQTT-WebSocket van de controller op het eigen netwerk. Voor koppelen zijn het lokale IP-adres en toegang tot de webinterface nodig. De app haalt de controllergegevens zelf op; er staan geen wachtwoorden in de repository.

Getest op een **REMKO WKF 80 met Smart Web**. Andere REMKO-modellen met dezelfde interface werken naar verwachting ook, maar zijn nog niet bevestigd. Laat via een [GitHub-issue](https://github.com/ZenoWebdev/homey-remko/issues) weten welk model je hebt en of de app daarop werkt.

## Functies

- Kamer- en gewenste temperatuur uitlezen; gewenste temperatuur in stappen van 0,5 °C instellen.
- Klimaatmodus automatisch, verwarmen of koelen kiezen.
- Buiten-, systeemaanvoer-, systeemretour- en warmwatertemperatuur uitlezen. De controller exposeert op deze installatie geen bruikbare afzonderlijke vloerverwarmingssensor; de twee systeemtemperaturen zijn daarom ook zo gelabeld.
- Hygiënemodus uit/gepland/dynamisch, wekelijkse dag en tijd, en actuele status lezen of instellen. De laatste **door deze app waargenomen** afloop wordt bewaard; de controller biedt via deze interface geen historische datum van een eerder voltooide cyclus.
- Flow-actie **Start reinigingscyclus via planning**: plant de statische cyclus twee minuten na de controllerklok, volgt of de controller hem actief meldt en herstelt de bestaande dag en tijd na afloop of als hij niet binnen zeven minuten begint. Deze functie vereist dat Gepland al is ingeschakeld en de installatie een geschikte extra warmtebron heeft. De actie gebruikt geen relais-testovername.
- Flow-acties **Start/stop extra boilerladen**. Start verhoogt tijdelijk het warmwaterdoel naar de ingestelde waarde (standaard 55 °C). Stop of het maximum van 180 minuten herstelt de oorspronkelijke instelling, zolang niemand die intussen zelf heeft veranderd. De REMKO-app meet zelf geen PV-productie; gebruik daarvoor een andere Homey-app als Flow-voorwaarde.
- REMKO-weer per uur, gekoppeld aan de klok van de controller. Het dagoverzicht en de Flow-tokens bevatten alleen resterende uren van vandaag: minimum/maximum, neerslag en aantal heldere of lichtbewolkte uren. Oude vrijdag-/zaterdaguren worden op zondag gefilterd.

## Installeren en koppelen

Vereist een Homey Pro met Homey 12.0.1 of nieuwer en een REMKO-controller die vanaf de Homey via HTTP en MQTT-WebSocket (`9001`) bereikbaar is.

```bash
npm install
homey app validate
homey app install
```

Open in de Homey-app **Apparaat toevoegen → REMKO Smart-Control Touch → Warmtepomp** en vul het lokale IP-adres van de controller in. Stel bij het apparaat het gewenste doel en de maximale duur voor extra boilerladen in.

## Flow-voorbeeld

1. **Wanneer:** de stroommeter-app meldt teruglevering.
2. **En:** **REMKO verwacht vandaag minstens N zonnige uren** en eventueel **Laatste waargenomen reinigingscyclus is meer dan N dagen geleden**.
3. **Dan:** **Start extra boilerladen** of, wanneer een reiniging gewenst is, **Start reinigingscyclus via planning**.
4. **Wanneer:** teruglevering stopt → **Stop extra boilerladen**. De maximumduur vormt een extra automatische stop.

Temperaturen, reinigingsstatus en de laatste waargenomen afloop zijn beschikbaar via Flow-kaarten. De voorwaarde **Laatste waargenomen reinigingscyclus is langer dan dagen geleden** wordt pas waar nadat deze app minstens één cyclus heeft waargenomen. Een onbekende oude datum wordt niet verzonnen.

In Flows betekent **Kamertemperatuur verandert** de gemeten temperatuur in de kamer. **Gewenste kamertemperatuur verandert** verwijst naar de ingestelde doeltemperatuur. Buiten, systeemaanvoer, systeemretour en warm water hebben afzonderlijke temperatuurkaarten.

## Ontwikkeling

```bash
npm test
homey app validate
```

De koppeling is getest met Smart-Control Touch 4.27. Schrijven van de kamertemperatuur en klimaatmodus was eerder op deze controller bevestigd. Voor het warmwaterdoel is 49 → 49,5 → 49 °C live met teruglezing getest. Een volledige hygiënecyclus duurt mogelijk uren; de geplande start moet nog tijdens een geschikte periode op de Homey Pro worden geobserveerd. De app heeft geen toegang tot een historisch succeslog van de controller.
