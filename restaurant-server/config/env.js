import dotenv from "dotenv";
dotenv.config();

// Optional: resolve DNS through specific servers (comma-separated), e.g.
// MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8 — for machines whose local DNS refuses the
// SRV lookup a mongodb+srv:// MONGO_URI needs (seen on the dev PC: Windows
// resolved it, Node got ECONNREFUSED, so a restart could not reach Atlas).
import dns from "node:dns";
if (process.env.MONGO_DNS_SERVERS) {
  dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map((s) => s.trim()).filter(Boolean));
}
