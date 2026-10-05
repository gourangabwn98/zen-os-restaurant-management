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

  Paper width: add "charsPerLine": 48 for an 80 mm roll (the default) or
  32 for a 58 mm roll, so the bill/KOT columns fit the paper exactly.

  The bill/KOT header (name, address, phone) and the logo come from Admin >
  Profile automatically. BILL_FOOTER in .env sets the last line of the bill.

  Unpaid bills end with a "Scan & Pay" QR: the payment QR uploaded in
  Admin > Profile (reprinted as a clean black-on-white QR), or - if none is
  uploaded - one made from the UPI ID with the bill amount filled in.
  PRINT_PAY_QR=false in .env turns it off.

  Bengali / Hindi text (restaurant name, customer, items) is printed as an
  image using the Windows font "Nirmala UI" (UNICODE_FONT in .env).


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

4) Keep it printing reliably
----------------------------
  * Copy the WHOLE folder. Without node_modules\ a USB_DIRECT printer can't
    be reached: the window then says
      "offline — waiting for it (USB support isn't available ...)"
    and nothing prints. Copy the node_modules folder back next to the .exe.

  * Clicking inside the black window no longer pauses printing (QuickEdit is
    switched off at start). Still: don't close the window.

  * The PC must not sleep: Settings > System > Power > Screen and sleep >
    "When plugged in, put my device to sleep after" = Never. A sleeping PC
    prints nothing until it wakes.

  * Before starting a NEW version for the first time after a long break:
    Admin > Profile > Print service > "Skip old jobs". Old tickets the server
    no longer lists are then never printed (the program checks this itself
    every few seconds).

  * A printer that is switched off / unplugged keeps its tickets waiting and
    prints them within a few seconds of coming back. Nothing is lost.

  * KOTs print when an order is SENT TO THE KITCHEN — by default 3 minutes
    after it is placed (the "edit window", Admin > Profile > Services). Set
    it to 0 to print the KOT at once, or press "Start preparing".
