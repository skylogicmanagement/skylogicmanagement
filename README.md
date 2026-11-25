# Sky Logic

Plataforma privada de gestion empresarial para activos, operaciones, inventario y
mantenimiento de operaciones de fumigacion agricola con drones.

## Estado actual

La implementación avanza por fases y requiere conectar un proyecto Supabase propio para
habilitar el acceso seguro.

- Fase 1 completada: arquitectura y modelo documentados.
- Fase 2 completada: React, Supabase, Tailwind, HashRouter y GitHub Pages configurados.
- Fase 3: identidad visual, acceso privado y dashboard inicial implementados.
- Fase 4 iniciada: listado, búsqueda y alta de activos con estado inicial no verificado.
- Fase 5 iniciada: operaciones, salidas, devoluciones parciales, lectura de horómetro y
  fincas con formularios transaccionales y sincronización en tiempo real.
- Fases 6 y 7 iniciadas: mantenimiento transaccional, planes preventivos, repuestos
  serializados, saldos por ubicación y movimientos de inventario.
- La fase de inventario requiere aplicar su migración incremental después del esquema
  inicial y la migración de mantenimiento.
- Auditoría visual, asociaciones automáticas de repuestos al mantenimiento, usuarios y
  reportes siguen en desarrollo.
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
