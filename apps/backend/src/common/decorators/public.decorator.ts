import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "movynta:isPublic";

/** Marks a route as reachable without a bearer token (health probes only). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
