import { createBrowserRouter, Navigate } from 'react-router'
import { RequireRole } from './auth/RequireRole.tsx'
import { AppLayout } from './layout/AppLayout.tsx'
import { StaffLayout } from './layout/StaffLayout.tsx'
import { AccountPage } from './pages/AccountPage.tsx'
import { ApplicationPage } from './pages/ApplicationPage.tsx'
import { ApplyPage } from './pages/ApplyPage.tsx'
import { AuctionPage } from './pages/AuctionPage.tsx'
import { CatalogPage } from './pages/CatalogPage.tsx'
import { ContractPage, ContractsPage } from './pages/ContractPage.tsx'
import { LotPage } from './pages/LotPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { OfferPage } from './pages/OfferPage.tsx'
import { ProductPage } from './pages/ProductPage.tsx'
import { SignInCodePage } from './pages/SignInCodePage.tsx'
import { SignInPage } from './pages/SignInPage.tsx'
import { StaffAuctionPage } from './pages/staff/StaffAuctionPage.tsx'
import { StaffAuctionsPage } from './pages/staff/StaffAuctionsPage.tsx'
import { StaffBranchesPage } from './pages/staff/StaffBranchesPage.tsx'
import { StaffHandoverPage } from './pages/staff/StaffHandoverPage.tsx'
import { StaffHandoversPage } from './pages/staff/StaffHandoversPage.tsx'
import { StaffProductCategoriesPage } from './pages/staff/StaffProductCategoriesPage.tsx'
import { StaffProductFormPage } from './pages/staff/StaffProductFormPage.tsx'
import { StaffProductsPage } from './pages/staff/StaffProductsPage.tsx'
import { StaffSignInPage } from './pages/staff/StaffSignInPage.tsx'

// One route tree for the whole app. Public Customer screens hang off AppLayout.
// Signed-in screens go in a nested layout route whose element checks the role:
// { element: <RequireRole role="Customer" />, children: [...] }. The back office is a separate
// /staff branch with its own StaffLayout; everything except /staff/sign-in sits inside
// <RequireRole role="Staff" />, so guards wrap whole sections, not single pages.
// Back-office pages live in pages/staff/, their API calls in api/backOffice.ts.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: 'categories/:code', element: <CatalogPage /> },
      { path: 'products/:id', element: <ProductPage /> },
      { path: 'auction', element: <AuctionPage /> },
      { path: 'auction/lots/:id', element: <LotPage /> },
      { path: 'sign-in', element: <SignInPage /> },
      { path: 'sign-in/code', element: <SignInCodePage /> },
      {
        element: <RequireRole role="Customer" />,
        children: [
          { path: 'account', element: <AccountPage /> },
          { path: 'products/:id/apply', element: <ApplyPage /> },
          { path: 'applications/:id', element: <ApplicationPage /> },
          { path: 'offers/:id', element: <OfferPage /> },
          { path: 'contracts', element: <ContractsPage /> },
          { path: 'contracts/:number', element: <ContractPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: 'staff',
    element: <StaffLayout />,
    children: [
      { path: 'sign-in', element: <StaffSignInPage /> },
      {
        element: <RequireRole role="Staff" />,
        children: [
          { index: true, element: <Navigate to="/staff/products" replace /> },
          { path: 'products', element: <StaffProductsPage /> },
          { path: 'products/new', element: <StaffProductFormPage /> },
          { path: 'products/:id', element: <StaffProductFormPage /> },
          { path: 'product-categories', element: <StaffProductCategoriesPage /> },
          { path: 'branches', element: <StaffBranchesPage /> },
          { path: 'auctions', element: <StaffAuctionsPage /> },
          { path: 'auctions/:id', element: <StaffAuctionPage /> },
          { path: 'handovers', element: <StaffHandoversPage /> },
          { path: 'handovers/:number', element: <StaffHandoverPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
