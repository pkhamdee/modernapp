import { Link, NavLink, useParams } from 'react-router'
import { catalogPaths, type ProductCategory, type ProductSummary } from '../api/catalog.ts'
import { useApi } from '../api/client.ts'
import { ProductPhoto } from '../components/ProductPhoto.tsx'
import { Status } from '../components/Status.tsx'
import { formatBaht, formatFlatRate } from '../format.ts'

export function CatalogPage() {
  const { code } = useParams()
  const categories = useApi<ProductCategory[]>(catalogPaths.productCategories())

  if (categories.status !== 'success') return <Status state={categories} />

  const selected = categories.data.find((c) => c.code === code) ?? categories.data[0]

  return (
    <>
      <section className="hero">
        <h1>ผ่อนสินค้าง่าย ๆ ใช้แค่บัตรประชาชน</h1>
        <p>รู้ผลภายใน 1 นาที ผ่อนนานสูงสุด 24 งวด</p>
      </section>

      <nav className="category-tabs" aria-label="ประเภทสินค้า">
        {categories.data.map((category) => (
          <NavLink
            key={category.code}
            to={`/categories/${category.code}`}
            className={() => (category.code === selected?.code ? 'category-tab active' : 'category-tab')}
            aria-current={category.code === selected?.code ? 'page' : undefined}
          >
            {category.name}
          </NavLink>
        ))}
      </nav>

      {selected && <CategoryProducts category={selected} />}
    </>
  )
}

function CategoryProducts({ category }: { category: ProductCategory }) {
  const products = useApi<ProductSummary[]>(catalogPaths.productsInCategory(category.code))

  return (
    <section aria-labelledby="category-heading">
      <div className="section-heading">
        <h2 id="category-heading">{category.name}</h2>
        <p>
          อัตราดอกเบี้ยคงที่ {formatFlatRate(category.flatRate)} ต่อเดือน · ผ่อนได้สูงสุด {category.longestTerm} งวด
        </p>
      </div>

      {products.status !== 'success' ? (
        <Status state={products} />
      ) : products.data.length === 0 ? (
        <p className="status">ยังไม่มีสินค้าในประเภทนี้</p>
      ) : (
        <ul className="card-grid">
          {products.data.map((product) => (
            <li key={product.id}>
              <Link to={`/products/${product.id}`} className="product-card">
                <ProductPhoto src={product.imageUrl} />
                <span className="product-name">{product.name}</span>
                <span className="product-price">{formatBaht(product.price)}</span>
                {product.fromInstallment !== null && (
                  <span className="product-from">ผ่อนเริ่มต้น {formatBaht(product.fromInstallment)} / เดือน</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
