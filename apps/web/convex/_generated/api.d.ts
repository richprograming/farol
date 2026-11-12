/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as carteira from "../carteira.js";
import type * as conta from "../conta.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as escritorio from "../escritorio.js";
import type * as exemplos from "../exemplos.js";
import type * as http from "../http.js";
import type * as motor from "../motor.js";
import type * as notas from "../notas.js";
import type * as plano from "../plano.js";
import type * as radar from "../radar.js";
import type * as resumo from "../resumo.js";
import type * as sugestoes from "../sugestoes.js";
import type * as tabelas from "../tabelas.js";
import type * as vigia from "../vigia.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  carteira: typeof carteira;
  conta: typeof conta;
  crons: typeof crons;
  demo: typeof demo;
  escritorio: typeof escritorio;
  exemplos: typeof exemplos;
  http: typeof http;
  motor: typeof motor;
  notas: typeof notas;
  plano: typeof plano;
  radar: typeof radar;
  resumo: typeof resumo;
  sugestoes: typeof sugestoes;
  tabelas: typeof tabelas;
  vigia: typeof vigia;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
