import { Injectable, inject, signal } from '@angular/core'
import { Router, type CanActivateFn } from '@angular/router'
import { type BuyerSelf, type DeveloperSelf } from '@tickover/contract'
import type { z } from 'zod'
import { ApiService, ApiError } from './api'

// `BuyerSelf` reaches the contract's surface as a schema only — unlike
// `DeveloperSelf` it has no companion `export type`. Same workaround as
// `buyer-auth.controller.ts:20` on the server.
type Buyer = z.infer<typeof BuyerSelf>

@Injectable({ providedIn: 'root' })
export class AuthState {
  private api = inject(ApiService)
  buyer = signal<Buyer | null>(null)
  developer = signal<DeveloperSelf | null>(null)
  admin = signal<boolean>(false)

  // Only a 401 means "not signed in", and only a 401 clears the principal signal.
  // A 500, a network blip or a malformed body is the API being unwell; returning
  // null for those would send a signed-in developer to the login page during a
  // deploy, and would leave the signal populated behind the redirect so the header
  // still read "signed in as…". Everything that is not a 401 is re-thrown so the
  // caller can tell "logged out" from "cannot tell".
  async refreshBuyer(): Promise<Buyer | null> {
    try {
      const b = await this.api.buyerMe()
      this.buyer.set(b)
      return b
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.buyer.set(null); return null }
      throw e
    }
  }
  async refreshDeveloper(): Promise<DeveloperSelf | null> {
    try {
      const d = await this.api.devMe()
      this.developer.set(d)
      return d
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.developer.set(null); return null }
      throw e
    }
  }
  async refreshAdmin(): Promise<boolean> {
    try {
      await this.api.adminMe()
      this.admin.set(true)
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.admin.set(false); return false }
      throw e
    }
  }
}

// The guards redirect on 401 only. A non-401 propagates out of the guard as a
// rejected navigation rather than a login redirect — the router surfaces it
// instead of silently pretending the user is signed out. A later task that wants
// a friendlier failure should add an error route and handle it there; it must not
// go back to treating every failure as "logged out".

export const buyerGuard: CanActivateFn = async () => {
  const auth = inject(AuthState), router = inject(Router)
  return (await auth.refreshBuyer()) ? true : router.createUrlTree(['/app/login'])
}
export const developerGuard: CanActivateFn = async () => {
  const auth = inject(AuthState), router = inject(Router)
  return (await auth.refreshDeveloper()) ? true : router.createUrlTree(['/developers'])
}
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthState), router = inject(Router)
  return (await auth.refreshAdmin()) ? true : router.createUrlTree(['/admin/login'])
}
