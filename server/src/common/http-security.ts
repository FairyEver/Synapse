import helmet from "helmet"

export function createHttpSecurityMiddleware(production: boolean) {
  return helmet({
    contentSecurityPolicy: production
      ? {
          useDefaults: true,
          directives: {
            "frame-ancestors": null,
          },
        }
      : false,
    frameguard: false,
  })
}
