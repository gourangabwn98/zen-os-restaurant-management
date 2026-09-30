SOHOJ PRINT SERVICE — Windows program
=====================================

Runs on the restaurant PC that is connected to the printers. It receives
KOT tickets and bills from the server and prints them. Node.js does NOT need
to be installed.

Keep ALL of these files together in one folder:

  SohojPrintService.exe    the program
  .env                     server address + printer key         (you edit)
  printers.config.json     which printer prints what            (you edit)
  data\                    print queue — created/used automatically, don't delete
  node_modules\            USB support for "USB_DIRECT" printers — don't delete
  .env.example             reference copy of .env
  README.txt               this file


1) .env  — connection to the server
-----------------------------------
  BACKEND_URL=https://your-backend.example.com     <- your server's URL
  PRINTER_KEY=prn_xxxxxxxxxxxxxxxx                 <- from Admin (shown only once)
  USE_MOCK_PRINTER=false

  Get a PRINTER_KEY by creating a printer device in the Admin app. Keep the
  key secret — it lets this program receive the restaurant's print jobs.


2) printers.config.json  — which printer prints what
----------------------------------------------------
  "role": "BILL" = bills,  "KOT" = kitchen tickets,  "BOTH" = everything.

  For BILL printing only, one printer is enough, e.g. a USB printer:

    {
      "printers": [
        { "id": "billing", "role": "BILL", "type": "USB",
          "windowsPrinterName": "EPSON_TM_T88V" }
      ]
    }

  or a network (LAN) printer:

        { "id": "billing", "role": "BILL", "type": "LAN",
          "ip": "192.168.1.60", "port": 9100 }

  USB receipt printer WITHOUT a Windows driver (most cheap POS-58/80
  printers — it doesn't appear in Printers & scanners): use

        { "id": "counter", "role": "BOTH", "type": "USB_DIRECT" }

  It is found automatically over USB. No driver, share, Print Spooler or
  admin rights needed.

  USB printer with a Windows driver: "windowsPrinterName" must be the exact name in Windows
  Settings > Printers & scanners, AND the printer must be SHARED:
  right-click it > Printer properties > Sharing > tick "Share this printer".
  If you gave the share a different name, also add "windowsShareName".

  One printer for both bills and KOT: use "role": "BOTH".


3) Run it
---------
  Double-click SohojPrintService.exe. A window opens and shows what it is
  doing ("Connected", "Printed bill ..."). Leave it open — closing the
  window stops printing. If a setting is missing it tells you which one and
  waits for Enter.

  Try it without paper first: set USE_MOCK_PRINTER=true in .env.

  Start automatically with Windows: press Win+R, type  shell:startup , and
  put a shortcut to SohojPrintService.exe in that folder.

  Restarting is always safe: jobs are saved in data\ and nothing is printed
  twice or lost.

  Windows SmartScreen may warn the first time ("unrecognised app") because
  the program isn't code-signed: click "More info" > "Run anyway".
