# AI Coding Instructions

- **Silo Rule**: Do not import components between modules. Use `/src/shared` for common items.
- **Component Size**: Keep components under 100 lines. Break into sub-components within the module's `/components` folder if they grow larger.
- **Mobile-First UI**: Use Tailwind. All buttons/inputs must be 44px+ for touch accuracy.
- **Config-Driven**: Do not hardcode commission rates in UI components. Use `src/modules/commission-calc/config/structures.ts`.
- **Validation**: Always implement "Sanity Checks" on user inputs to prevent unit errors (kWh vs MWh).
