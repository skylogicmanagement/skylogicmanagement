# Sky Logic

Plataforma privada de gestion empresarial para activos, operaciones, inventario y
mantenimiento de operaciones de fumigacion agricola con drones.

## Estado actual

La implementación avanza por fases y requiere conectar un proyecto Supabase propio para
habilitar el acceso seguro.

- Fase 1 completada: arquitectura y modelo documentados.
- Fase 2 completada: React, Supabase, Tailwind, HashRouter y GitHub Pages configurados.
- Fase 3: identidad visual, acceso privado y dashboard inicial implementados.
- Fase 4: listado, búsqueda, alta y edición de fichas de activos con seriales,
  adquisición, proveedor, ubicación, responsable, datos técnicos de baterías y hoja de
  vida cronológica; asignación manual de responsables y componentes a drones con
  historial de liberaciones.
- Fase 5 iniciada: operaciones, salidas, devoluciones parciales, lectura de horómetro y
  fincas con formularios transaccionales y sincronización en tiempo real. Los pilotos
  se administran sin cuentas de acceso y se asignan por dron y operación.
- Fase 8 iniciada: consulta de auditoría con filtros por entidad, acción y fechas,
  detalle de cambios y verificación manual de la cadena SHA-256.
- Fases 4, 6 y 7 iniciadas: edición de fichas, mantenimiento transaccional y descuento
  atómico de repuestos, con inventario serializado y saldos por ubicación.
- La edición de fichas de activos requiere aplicar la migración incremental
  `20261125150000_asset_profile_editing.sql`.
- Las asignaciones manuales requieren aplicar una sola vez
  `20261125160000_asset_assignment_workflows.sql`.
- La administración y asignación de pilotos requiere aplicar
  `20261125161000_pilot_management.sql` después de la migración de asignaciones.
- Auditoría visual, alertas de stock mínimo, adjuntos, usuarios y reportes siguen en
  desarrollo.
- Sigue [las instrucciones de configuración](docs/setup.md) antes de usar la nueva
  migración en Supabase.
- La conexión real aún no se ha probado contra el proyecto Supabase de Sky Logic.

## Documentacion

- [Arquitectura y decisiones tecnicas](docs/architecture.md)
- [Modelo de datos](docs/database.md)
- [Seguridad y auditoria](docs/security.md)
- [Plan de implementacion](docs/implementation-plan.md)
- [Configuracion local y despliegue](docs/setup.md)
- [Migración inicial de Supabase](supabase/migrations/20261125130000_initial_schema.sql)
- [Flujos transaccionales de mantenimiento](supabase/migrations/20261125134500_maintenance_workflows.sql)
- [Flujos transaccionales de inventario](supabase/migrations/20261125143000_inventory_workflows.sql)
- [Edición segura de fichas de activos](supabase/migrations/20261125150000_asset_profile_editing.sql)
- [Integración de repuestos con mantenimiento](supabase/migrations/20261125153000_maintenance_inventory_integration.sql)
- [Alertas preventivas de mantenimiento](supabase/migrations/20261125154500_maintenance_alerts.sql)
- [Flujos de asignación de activos](supabase/migrations/20261125160000_asset_assignment_workflows.sql)
- [Administración de pilotos y asignación por operación](supabase/migrations/20261125161000_pilot_management.sql)

## Ejecucion local

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Configura las variables publicas de Supabase sin agregar credenciales privilegiadas.

Para este repositorio, GitHub Pages publicará en
`https://skylogicmanagement.github.io/skylogicmanagement/`.

## Validacion

```powershell
npm run build
npm run lint
```
