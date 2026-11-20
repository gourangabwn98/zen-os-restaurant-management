/*
 * Zen OS — Structurizr DSL (C4 model). Built from the 2026-11-20 read-only audit.
 * Tags "Planned"/"Proposed" mark elements without code.
 */
workspace "Zen OS" "Single-restaurant POS and operations platform" {

  model {
    admin = person "Admin / Owner" "Owner; full access (role admin / isAdmin)"
    manager = person "Manager" "Orders, invoices, tables, inventory, employees, menu, delivery"
    waiter = person "Waiter" "Floor operations; must be on duty"
    chef = person "Chef" "Kitchen board only"
    customer = person "Customer" "QR / takeaway / delivery ordering (login required)"
    rider = person "Delivery partner" "Rider app"

    firebase = softwareSystem "Firebase" "Auth + FCM" "External"
    phonepe = softwareSystem "PhonePe PG V1" "Online payments" "External"
    sms = softwareSystem "Twilio / MSG91" "SMS OTP, WhatsApp" "External"
    cloudinary = softwareSystem "Cloudinary" "Images" "External"
    google = softwareSystem "Google Maps / Routes" "Maps, ETA" "External"
    printers = softwareSystem "Thermal printers" "LAN / USB" "External"

    zen = softwareSystem "Zen OS" "Restaurant POS platform" {
      api = container "restaurant-server" "REST /api/*, Socket.IO rooms, state machine, pricing, payments, stock, print jobs, ticks" "Node 22, Express 5, Socket.IO 4, Mongoose 9"
      db = container "Database" "One MongoDB database (Atlas or local replica set)" "MongoDB" "Database"
      adminApp = container "Admin app" "Back office + POS" "React 19, Vite 8, PWA"
      waiterApp = container "Waiter app" "Floor operations" "React 18, PWA"
      kitchenApp = container "Kitchen app" "KOT board, PII-stripped" "React 18, PWA"
      customerApp = container "Customer app" "Menu, cart, checkout, tracking" "React 18 SPA"
      deliveryApp = container "Delivery app" "Rider offers, jobs, GPS" "React Native 0.77 + Kotlin"
      printService = container "print-service" "Durable local queue; drives printers" "Node SEA SohojPrintService.exe (Windows)"
      localApps = container "Local static app servers" "LAN hosting of 4 SPAs (LOCAL mode)" "Node http"
      syncAgent = container "Sync agent / cloud relay" "Outbox/inbox site to cloud" "Planned" "Planned"
      androidAgent = container "Android print agent" "PC-free printing" "Proposed" "Proposed"
    }

    api -> db "Reads/writes, transactions" "MongoDB wire"
    adminApp -> api "REST + Socket.IO" "HTTPS/WSS, JWT"
    waiterApp -> api "REST + Socket.IO" "HTTPS/WSS, JWT"
    kitchenApp -> api "REST + Socket.IO" "HTTPS/WSS, JWT"
    customerApp -> api "REST + Socket.IO" "HTTPS/WSS, JWT or guest"
    deliveryApp -> api "REST + Socket.IO" "HTTPS/WSS, JWT"
    printService -> api "get-queue / report-job-status" "WSS, printer key"
    syncAgent -> db "Change stream capture" "Planned"
    androidAgent -> api "Printer protocol" "Proposed"

    admin -> adminApp "Uses"
    manager -> adminApp "Uses"
    waiter -> waiterApp "Uses"
    chef -> kitchenApp "Uses"
    customer -> customerApp "Uses"
    rider -> deliveryApp "Uses"

    api -> firebase "Verify ID tokens, push" "HTTPS"
    api -> phonepe "Pay / status" "HTTPS X-VERIFY"
    phonepe -> api "Callback" "HTTPS X-VERIFY"
    api -> sms "OTP / WhatsApp" "HTTPS"
    api -> cloudinary "Uploads" "HTTPS"
    api -> google "Routes" "HTTPS"
    printService -> printers "ESC/POS" "TCP 9100 / USB"
    androidAgent -> printers "ESC/POS" "Proposed"

    production = deploymentEnvironment "Production (inferred)" {
      deploymentNode "Vercel" {
        containerInstance adminApp
        containerInstance waiterApp
        containerInstance customerApp
      }
      deploymentNode "Render" {
        containerInstance api
      }
      deploymentNode "MongoDB Atlas" {
        containerInstance db
      }
      deploymentNode "Restaurant Windows PC" {
        containerInstance printService
      }
    }

    offline = deploymentEnvironment "Offline Edition (LOCAL_PRIMARY)" {
      deploymentNode "Restaurant PC" {
        containerInstance api
        containerInstance db
        containerInstance localApps
        containerInstance printService
      }
    }
  }

  views {
    systemContext zen "SystemContext" {
      include *
      autoLayout lr
    }
    container zen "Containers" {
      include *
      autoLayout lr
    }
    deployment zen production "DeploymentCloud" {
      include *
      autoLayout lr
    }
    deployment zen offline "DeploymentLocal" {
      include *
      autoLayout lr
    }
    styles {
      element "Person" {
        shape Person
        background #08427b
        color #ffffff
      }
      element "Container" {
        background #1168bd
        color #ffffff
      }
      element "Database" {
        shape Cylinder
      }
      element "External" {
        background #999999
        color #ffffff
      }
      element "Planned" {
        border dashed
        background #ffffff
        color #333333
      }
      element "Proposed" {
        border dashed
        background #ffffff
        color #333333
      }
    }
  }
}
