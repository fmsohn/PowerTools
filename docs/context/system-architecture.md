# System Architecture Manifest

## Core Principles
- **Mobile-First PWA**: Offline-capable, static deployment (Vite/React/Tailwind).
- **Feature-Siloed (Modular)**: Each feature lives in `src/modules/[feature-name]`.
- **Zero-Backend**: No database. All state is `sessionStorage` (temporary) or `localStorage` (for user profiles).
- **Developer-Managed**: Business logic is updated via code (GitHub pushes), not a user-facing admin panel.

## Folder Structure
- `/src/core`: App shell, PWA registry, and global navigation.
- `/src/shared`: Reusable UI components (Buttons, Inputs) and global math/unit utilities.
- `/src/modules`: Independent business units (e.g., `commission-calc`, `savings-analysis`).

## Tech Stack
- Frontend: React (Vite)
- Styling: Tailwind CSS
- PWA: vite-plugin-pwa
- Logic: TypeScript (Strict)
