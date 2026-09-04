# Sohoj Customer App

Customer-facing QR menu and ordering app for the Sohoj restaurant SaaS.

## Flow
1. Customer scans QR code at table → lands on menu page
2. Browses categories (images from DB, in creation order)
3. Adds items to cart
4. Goes to cart → fills name, phone, table number → places order
5. Sees live order tracking page (auto-refreshes every 20s)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your backend URL
npm run dev
```

## Environment

```
VITE_API_URL=https://sohoj-os-admin-backend.onrender.com/api
```

## Build & Deploy (Vercel)

```bash
npm run build
# Push to GitHub → connect repo on vercel.com → auto-deploys
```

Set `VITE_API_URL` as an environment variable in Vercel dashboard.

## API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /restaurant/profile` | Restaurant name, banners, services, geo |
| `GET /menu/categories` | Categories with images (DB insertion order) |
| `GET /menu?category=X` | Menu items by category |
| `POST /orders` | Place guest order |
| `GET /orders/:id` | Order tracking |

## Project Structure

```
src/
  pages/
    MenuPage.jsx      ← Main menu with categories & items
    CartPage.jsx      ← Cart, order details, place order
    OrderPage.jsx     ← Order confirmation & live tracking
  services/
    api.js            ← Axios base instance
    menuService.js    ← Menu + categories API
    restaurantService.js ← Restaurant profile API
    orderService.js   ← Place & track orders
  hooks/
    useCart.js        ← In-memory cart state
  App.jsx             ← Router
  main.jsx            ← Entry point
  index.css           ← Global styles + animations
```
