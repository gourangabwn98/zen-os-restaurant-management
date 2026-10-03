// middleware/validateIds.js
// Every ":id"-style route param here is a MongoDB ObjectId (they are all
// looked up with findById). A malformed one used to reach Mongoose and come
// back as a 500 with a CastError message; it is simply "not found".
// Wired per router with router.param("id", objectIdParam) etc.
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const objectIdParam = (req, res, next, value) =>
  (OBJECT_ID.test(String(value)) ? next() : res.status(404).json({ message: "Not found" }));
