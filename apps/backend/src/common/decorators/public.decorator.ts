import { SetMetadata } from "@nestjs/common";

/** The metadata key that marks a route as reachable without a bearer token. */
export const IS_PUBLIC_KEY = "movynta:isPublic";

/** Marks a route as reachable without a bearer token (health probes only). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
