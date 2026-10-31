import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NodeAdapter } from "@nestjs/platform-node";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new NodeAdapter());
  await app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
}

await bootstrap();

