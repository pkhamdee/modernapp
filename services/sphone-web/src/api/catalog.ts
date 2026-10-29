// Types mirror sphone-api's catalog responses (GLOSSARY: Product Category, Product, Flat Rate, Term).

export interface ProductCategory {
  code: string
  name: string
  /** Monthly Flat Rate as a fraction: 0.015 = 1.5% per month. */
  flatRate: number
  /** Longest Term (number of monthly Installments) offered. */
  longestTerm: number
}

export interface ProductSummary {
  id: number
  name: string
  price: number
  productCategoryCode: string
}

export interface ProductDetail {
  id: number
  name: string
  description: string
  price: number
  productCategory: ProductCategory
}

export const catalogPaths = {
  productCategories: () => '/product-categories',
  productsInCategory: (code: string) => `/product-categories/${encodeURIComponent(code)}/products`,
  product: (id: string | number) => `/products/${encodeURIComponent(String(id))}`,
}
