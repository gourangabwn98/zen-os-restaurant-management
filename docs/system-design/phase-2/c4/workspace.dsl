/*
 * Zen OS — C4 model (Structurizr DSL)
 * Generated 2026-11-20 from the Phase 1 discovery report. VERIFIED ELEMENTS ONLY.
 *
 * Included:  everything found in code on branch features/offline-edition (working tree).
 *            Elements implemented but uncommitted carry the tag "Uncommitted".
 *            Hosting providers are inferred from repo config files and carry the tag "Inferred".
 * Excluded on purpose (no code — PLANNED/PROPOSED, see docs/system-design/phase-2):
 *            sync agent, cloud mirror/ingest/relay, Android print agent, PhonePe V2, refunds,
 *            capability gate for restricted offline mode, LAN customer ordering (O3).
 * Not validated with the Structurizr CLI (not installed).
 */
workspace "Zen OS" "Single-restaurant POS and operations platform (verified model)" {

  model {
    admin = person "Admin / Owner" "Full access (role admin or isAdmin)."
    manager = person "Manager" "Orders, invoices, tables, inventory, employees, menu, delivery."
    invManager = person "Inventory manager" "Inventory pages only."
    waiter = person "Waiter" "Floor operations; must be on duty for order actions."
    chef = person "Chef" "Kitchen board: start preparing, mark ready."
    customer = person "Customer" "Orders by QR / takeaway / delivery; login required to place an order."
    rider = person "Delivery partner" "Accepts and delivers home-delivery orders."

    firebase = softwareSystem "Firebase" "Phone authentication and Cloud Messaging." "External"
    phonepe = softwareSystem "PhonePe Payment Gateway (V1)" "Hosted checkout, status API, server callback." "External"
    smsProviders = softwareSystem "Twilio / MSG91" "SMS OTP and WhatsApp text." "External"
    cloudinary = softwareSystem "Cloudinary" "Image storage." "External"
    google = softwareSystem "Google Maps / Directions / Routes" "Maps and route ETA (optional keys)." "External"
    printers = softwareSystem "Thermal printers" "ESC/POS printers on LAN or USB." "External"

    zen = softwareSystem "Zen OS" "Restaurant POS and operations platform." {

      api = container "restaurant-server" "REST API under /api, Socket.IO hub, business rules, background ticks." "Node.js 22, Express 5, Socket.IO 4, Mongoose 9" {
        httpLayer = component "HTTP routes and controllers" "25 route files, 276 handlers; thin controllers." "Express routers"
        authRbac = component "Auth and RBAC middleware" "protect, optionalProtect, requireRole family, managerScope, requireWaiterOnDuty, sanitizeInput." "Express middleware"
        orderSvc = component "Order service" "Order lifecycle, state machine, edit window, send to kitchen, edits after KOT, cancel." "orderService.js, orderStateMachine.js"
        kotSvc = component "KOT service" "One KOT per order, change slips per revision." "kotService.js"
        billingSvc = component "Billing service" "Settle, split, combined bill, reopen, completion." "billingService.js, combinedBillService.js"
        paymentSvc = component "Payment service" "PhonePe V1 initiate/status/callback, atomic apply, pay-first promote/expire." "paymentService.js, payFirstService.js"
        inventorySvc = component "Inventory service" "Recipe deduction, reversal, purchases, wastage, ledger, V3 (flag)." "inventoryService.js, inventoryV3*.js"
        menuSvc = component "Menu services" "Sections, schedules, menu times, sold-out restore, import." "menu*.js, category*.js"
        staffSvc = component "Staff services" "Employees, attendance and duty history, leave, pay, reports." "employeeService.js, attendanceService.js"
        deliverySvc = component "Delivery service" "Jobs, offers, atomic accept, OTP drop, COD custody, tracking." "deliveryService.js, deliveryRealtime.js"
        printerDeviceSvc = component "Printer device service" "Printer keys (hashed), last seen, stale job expiry." "printerDeviceService.js"
        socketHub = component "Socket hub" "Handshake (JWT, printer key, guest), role rooms, typed emitters, print queue events." "sockets/socket.js"
        ticks = component "Background ticks" "Offers 30 s, auto-send 15 s, pay-first 60 s, delivery 5 s, category reset 60 s." "setInterval in server.js"
        localAuth = component "Offline Edition auth and LAN gate" "Device registration, PIN login, sessions, LAN-only routes, static app hosting (LOCAL mode only)." "localAuthService.js, local/*" "Uncommitted"
        models = component "Data models" "55 Mongoose schemas with business-rule indexes." "config/*Models.js"
      }

      db = container "Database" "One MongoDB database per restaurant." "MongoDB (Atlas or local replica set)" "Database"
      adminApp = container "Admin app" "Back office, POS, kitchen display, delivery board, devices (LOCAL)." "React 19, Vite 8, PWA"
      waiterApp = container "Waiter app" "Tables, orders, bills, payments, duty, waiter calls." "React 18, Vite 5, PWA"
      kitchenApp = container "Kitchen app" "KOT board without customer data." "React 18, Vite 5, PWA"
      customerApp = container "Customer app" "Menu, cart, checkout, PhonePe/UPI, tracking, reviews." "React 18, Vite 5"
      deliveryApp = container "Delivery app" "Rider offers, jobs, OTP hand-over, COD, GPS service." "React Native 0.77, Kotlin"

      printService = container "print-service" "Bridges backend print jobs to printers with a durable local queue." "Node.js, SohojPrintService.exe (Windows)" {
        psSocket = component "Socket client" "Printer-key handshake, reconnect 1-30 s, get-queue on connect and every 5 s, status reports." "socket.io-client"
        psQueue = component "Local queue" "Disk-persisted jobs keyed by backend job id; PRINTED is terminal." "data/queue.json"
        psProcessor = component "Processor" "Picks jobs, retries with backoff, waits while printer offline." "processor.js"
        psRender = component "Renderers" "KOT and bill layout, logo, pay QR, Bengali raster via Windows GDI+." "renderers/*, textImage.js"
        psPrinters = component "Printer manager and drivers" "Role routing KOT/BILL/BOTH; LAN, USB share, USB_DIRECT." "printerManager.js, drivers/*"
      }
    }

    # People
    admin -> adminApp "Uses"
    manager -> adminApp "Uses"
    invManager -> adminApp "Uses (inventory)"
    waiter -> waiterApp "Uses"
    chef -> kitchenApp "Uses"
    customer -> customerApp "Uses"
    rider -> deliveryApp "Uses"

    # Containers
    adminApp -> httpLayer "Calls" "HTTPS, JWT"
    waiterApp -> httpLayer "Calls" "HTTPS, JWT"
    kitchenApp -> httpLayer "Calls" "HTTPS, JWT"
    customerApp -> httpLayer "Calls" "HTTPS, JWT or guest token"
    deliveryApp -> httpLayer "Calls" "HTTPS, JWT"
    adminApp -> socketHub "Subscribes" "WSS"
    waiterApp -> socketHub "Subscribes" "WSS"
    kitchenApp -> socketHub "Subscribes (kitchen room)" "WSS"
    customerApp -> socketHub "Subscribes (own order)" "WSS"
    deliveryApp -> socketHub "Subscribes (own user room)" "WSS"
    adminApp -> firebase "Phone login" "Firebase JS SDK"
    customerApp -> firebase "Phone login, web push" "Firebase JS SDK"
    customerApp -> phonepe "Redirects customer to pay" "HTTPS"

    # Backend components
    httpLayer -> authRbac "Applies"
    authRbac -> models "Loads user"
    httpLayer -> orderSvc "Uses"
    httpLayer -> billingSvc "Uses"
    httpLayer -> paymentSvc "Uses"
    httpLayer -> inventorySvc "Uses"
    httpLayer -> menuSvc "Uses"
    httpLayer -> staffSvc "Uses"
    httpLayer -> deliverySvc "Uses"
    httpLayer -> printerDeviceSvc "Uses"
    httpLayer -> localAuth "Uses (LOCAL mode)"
    orderSvc -> kotSvc "Creates KOT in kitchen-send transaction"
    orderSvc -> inventorySvc "Deducts / restocks in transaction"
    billingSvc -> orderSvc "Completes settled orders"
    paymentSvc -> orderSvc "Promotes paid orders"
    deliverySvc -> orderSvc "Marks delivered (rider OTP)"
    ticks -> orderSvc "Auto-send to kitchen"
    ticks -> paymentSvc "Pay-first promote / expire"
    ticks -> deliverySvc "Dispatch tick"
    orderSvc -> socketHub "Emits order and KOT events"
    billingSvc -> socketHub "Emits payment and bill events"
    deliverySvc -> socketHub "Emits delivery events"
    socketHub -> printerDeviceSvc "Verifies printer keys, expires stale jobs"
    orderSvc -> models "Reads/writes"
    kotSvc -> models "Reads/writes"
    billingSvc -> models "Reads/writes"
    paymentSvc -> models "Reads/writes"
    inventorySvc -> models "Reads/writes"
    menuSvc -> models "Reads/writes"
    staffSvc -> models "Reads/writes"
    deliverySvc -> models "Reads/writes"
    printerDeviceSvc -> models "Reads/writes"
    socketHub -> models "Reads/writes print job status"
    localAuth -> models "Reads/writes local auth collections"
    models -> db "Reads/writes, transactions" "MongoDB wire protocol"

    # External from backend
    authRbac -> firebase "Verifies ID tokens" "Firebase Admin SDK"
    paymentSvc -> phonepe "Pay and status calls" "HTTPS, X-VERIFY"
    phonepe -> httpLayer "Payment callback" "HTTPS, X-VERIFY"
    staffSvc -> smsProviders "Sends staff OTP" "HTTPS"
    menuSvc -> cloudinary "Uploads images" "HTTPS"
    deliverySvc -> google "Route ETA" "HTTPS"
    httpLayer -> firebase "Sends offer push" "FCM"

    # Print service components
    psSocket -> socketHub "get-queue, report-job-status; receives kot:created, bill:print" "WSS, printer key"
    psSocket -> psQueue "Upserts jobs"
    psProcessor -> psQueue "Reads / marks jobs"
    psProcessor -> psRender "Renders"
    psProcessor -> psPrinters "Prints"
    psProcessor -> psSocket "Reports status"
    psRender -> httpLayer "Reads public restaurant profile" "HTTPS"
    psPrinters -> printers "ESC/POS bytes" "TCP 9100, Windows share, WinUSB"

    deploymentEnvironment "Production" {
      deploymentNode "Vercel" "Static hosting (inferred from vercel.json)" "Vercel" "Inferred" {
        containerInstance adminApp
        containerInstance waiterApp
        containerInstance customerApp
      }
      deploymentNode "Kitchen app hosting" "Not determinable from the repository" "UNKNOWN" "Inferred" {
        containerInstance kitchenApp
      }
      deploymentNode "Render" "Backend web service (inferred from RENDER_GIT_COMMIT)" "Render" "Inferred" {
        containerInstance api
      }
      deploymentNode "MongoDB Atlas" "Managed MongoDB (inferred)" "Atlas" "Inferred" {
        containerInstance db
      }
      deploymentNode "Restaurant Windows PC" "On-premises" "Windows" {
        containerInstance printService
      }
      deploymentNode "Rider Android phone" "" "Android" {
        containerInstance deliveryApp
      }
    }

    deploymentEnvironment "Offline Edition" {
      deploymentNode "Restaurant PC" "LOCAL_PRIMARY server (O1/O2, uncommitted)" "Windows, Node.js 22" "Uncommitted" {
        deploymentNode "Node.js" "DEPLOYMENT_MODE=LOCAL; serves the four web apps on ports 8080-8083" "Node.js 22" {
          containerInstance api
          containerInstance adminApp
          containerInstance waiterApp
          containerInstance kitchenApp
          containerInstance customerApp
        }
        deploymentNode "MongoDB" "Single-node replica set on 127.0.0.1" "MongoDB 7" {
          containerInstance db
        }
        deploymentNode "Print bridge" "" "SohojPrintService.exe" {
          containerInstance printService
        }
      }
    }
  }

  views {
    systemContext zen "SystemContext" "Zen OS system context (verified)." {
      include *
      autoLayout lr
    }

    container zen "Containers" "Zen OS containers (verified)." {
      include *
      autoLayout lr
    }

    component api "BackendComponents" "restaurant-server components." {
      include *
      autoLayout lr
    }

    component printService "PrintServiceComponents" "print-service components." {
      include *
      autoLayout lr
    }

    deployment zen "Production" "DeploymentProduction" "Production deployment (hosting inferred from repo config)." {
      include *
      autoLayout lr
    }

    deployment zen "Offline Edition" "DeploymentOfflineEdition" "Offline Edition on the restaurant PC (O1/O2, uncommitted)." {
      include *
      autoLayout lr
    }

    styles {
      element "Person" {
        shape Person
        background #08427b
        color #ffffff
      }
      element "Software System" {
        background #1168bd
        color #ffffff
      }
      element "Container" {
        background #438dd5
        color #ffffff
      }
      element "Component" {
        background #85bbf0
        color #000000
      }
      element "Database" {
        shape Cylinder
      }
      element "External" {
        background #999999
        color #ffffff
      }
      element "Uncommitted" {
        border dashed
      }
      element "Inferred" {
        border dashed
      }
    }
  }
}
