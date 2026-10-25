# Homey REMKO

Werkmap voor [homey-remko](https://github.com/ZenoWebdev/homey-remko).

## Repository ophalen

Deze map bevat al een afgeschermde `.git`-map en is daardoor zelf geen bruikbare Git-checkout. Clone de repository in een submap:

```bash
git clone https://github.com/ZenoWebdev/homey-remko.git /home/zeno/remko/homey-remko
```

## Deze README toevoegen en pushen

Voer dit uit in een terminal op je eigen computer, met toegang tot GitHub:

```bash
cp /home/zeno/remko/README.md /home/zeno/remko/homey-remko/README.md
cd /home/zeno/remko/homey-remko
git status
git add README.md
git commit -m "Add README"
git push origin HEAD
```

Controleer vóór het kopiëren of de repository al een `README.md` bevat: `cp` zou die overschrijven. Bij het pushen kan GitHub om aanmelding vragen. Je hebt schrijfrechten op de repository nodig.
