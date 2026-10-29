import { apiPost, apiPut } from './client.ts'

// Mirrors sphone-api's Staff-only /api/back-office endpoints (Product, Product Category, Branch).

export interface BackOfficeProduct {
  id: number
  name: string
  description: string
  price: number
  productCategoryCode: string
  imageId: string | null
  imageUrl: string | null
  isRetired: boolean
}

export interface ProductInput {
  productCategoryCode: string
  name: string
  description: string
  price: number
  /** From uploadProductPhoto (or the Product's current photo); null for no photo. */
  imageId: string | null
}

export interface BackOfficeProductCategory {
  code: string
  name: string
  /** Monthly Flat Rate as a fraction: 0.015 = 1.5% per month. */
  flatRate: number
  longestTerm: number
  activeProducts: number
}

export interface BackOfficeBranch {
  code: string
  name: string
  address: string
  province: string
  isRetired: boolean
}

export type BranchInput = Pick<BackOfficeBranch, 'name' | 'address' | 'province'>

export interface ProductPhoto {
  imageId: string
  imageUrl: string
}

/** Terms S Phone offers; a Product Category's longest Term is one of these. */
export const TERMS = [6, 10, 12, 18, 24] as const

export const backOfficePaths = {
  products: () => '/back-office/products',
  productCategories: () => '/back-office/product-categories',
  branches: () => '/back-office/branches',
}

const product = (id: number) => `/back-office/products/${id}`
const branch = (code: string) => `/back-office/branches/${encodeURIComponent(code)}`

export const addProduct = (input: ProductInput) => apiPost<BackOfficeProduct>('/back-office/products', input)
export const editProduct = (id: number, input: ProductInput) => apiPut<BackOfficeProduct>(product(id), input)
export const retireProduct = (id: number) => apiPost<void>(`${product(id)}/retire`)
export const reinstateProduct = (id: number) => apiPost<void>(`${product(id)}/reinstate`)

/** Uploads a photo (JPEG, PNG or WebP, at most 10 MB) to the image service's public area. */
export const uploadProductPhoto = (file: File) => apiPost<ProductPhoto>('/back-office/product-photos', file)

export const updateProductCategory = (code: string, settings: { flatRate: number; longestTerm: number }) =>
  apiPut<BackOfficeProductCategory>(`/back-office/product-categories/${encodeURIComponent(code)}`, settings)

export const addBranch = (input: BranchInput & { code: string }) => apiPost<BackOfficeBranch>('/back-office/branches', input)
export const editBranch = (code: string, input: BranchInput) => apiPut<BackOfficeBranch>(branch(code), input)
export const retireBranch = (code: string) => apiPost<void>(`${branch(code)}/retire`)
export const reinstateBranch = (code: string) => apiPost<void>(`${branch(code)}/reinstate`)
