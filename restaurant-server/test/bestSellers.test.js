// test/bestSellers.test.js — run: node test/bestSellers.test.js
import assert from "node:assert/strict";
import { pickBestSellers } from "../services/bestSellerService.js";

const item = (id, name) => ({ _id: id, name, price: 100, category: "Main", tag: "Veg", image: "" });
const visible = new Map([["a", item("a", "Biryani")], ["c", item("c", "Tea")], ["d", item("d", "Momo")]]);
const rows = [{ _id: "a", qty: 30 }, { _id: "b", qty: 25 }, { _id: "c", qty: 10 }, { _id: "d", qty: 0 }];

const out = pickBestSellers(rows, visible, 5);
assert.deepEqual(out.map((x) => x.name), ["Biryani", "Tea"]);   // b hidden/unavailable, d never sold
assert.equal(out[0].sold, 30);
assert.equal(pickBestSellers(rows, visible, 1).length, 1);          // limit
assert.deepEqual(pickBestSellers([], visible, 5), []);              // no sales → nothing invented
console.log("bestSellers: all tests passed");
