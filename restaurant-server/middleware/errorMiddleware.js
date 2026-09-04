export const notFound = (req, res, next) => {
  next(new Error(`Not Found — ${req.originalUrl}`));
};

export const errorHandler = (err, req, res, _next) => {
  const code = res.statusCode === 200 ? 500 : res.statusCode;
  console.error(err.message);
  res.status(code).json({
    message: err.message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
