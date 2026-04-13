# Home Server And Cloudflare Deploy

## Doporučený stack

- Ubuntu Server
- Node.js 20+
- `npm`
- Cloudflare Named Tunnel
- vlastní doména v Cloudflare DNS
- systemd pro app a `cloudflared`

## Příprava serveru

1. Vytvořte systémového uživatele:
   `sudo useradd --system --create-home --shell /usr/sbin/nologin flexiapp`
2. Nakopírujte projekt do `/opt/flexi-chatgpt-app`.
3. Vygenerujte app klíč:
   `node scripts/generate-app-key.mjs`
4. Vyplňte `.env`.
5. Spusťte:
   `npm install && npm run build`

## Cloudflare Named Tunnel

1. Nainstalujte `cloudflared`.
2. Přihlaste se:
   `cloudflared tunnel login`
3. Vytvořte tunnel:
   `cloudflared tunnel create flexi-chatgpt-app`
4. Zkopírujte template z `deploy/cloudflared/flexi-chatgpt-app.yml` do `/etc/cloudflared/`.
5. Nastavte DNS:
   `cloudflared tunnel route dns flexi-chatgpt-app flexi.example.com`

## systemd

1. Zkopírujte:
   - `deploy/systemd/flexi-chatgpt-app.service`
   - `deploy/systemd/cloudflared-tunnel.service`
2. Aktivujte:
   `sudo systemctl daemon-reload`
   `sudo systemctl enable --now flexi-chatgpt-app`
   `sudo systemctl enable --now cloudflared-tunnel`

## Backups

- pravidelně spouštějte `scripts/backup-app-data.sh`
- zálohujte `.chatgpt-app-data`
- zálohujte `.env`
- otestujte restore na samostatném hostu

## Kdy zvolit raději EU VPS

- pokud je domácí internet nestabilní
- pokud potřebujete lepší dostupnost pro OpenAI review
- pokud nemáte spolehlivé zálohy a monitoring
- pokud účetní data vyžadují profesionální fyzické zabezpečení
