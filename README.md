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
- Fase 6 iniciada: intervenciones de mantenimiento, cierre con estado/costo/resultado y
  planes preventivos configurables.
- Base de datos: migración inicial preparada, pendiente de aplicación en Supabase.
- Mantenimiento, inventario, auditoría visual, usuarios y reportes siguen en desarrollo.
- Para activar la nueva fase, aplica la migración de mantenimiento siguiendo
  [las instrucciones de configuración](docs/setup.md).
- La conexión real aún no se ha probado contra el proyecto Supabase de Sky Logic.

## Documentacion

- [Arquitectura y decisiones tecnicas](docs/architecture.md)
- [Modelo de datos](docs/database.md)
- [Seguridad y auditoria](docs/security.md)
- [Plan de implementacion](docs/implementation-plan.md)
- [Configuracion local y despliegue](docs/setup.md)
- [Migración inicial de Supabase](supabase/migrations/20261125130000_initial_schema.sql)
- [Flujos transaccionales de mantenimiento](supabase/migrations/20261125134500_maintenance_workflows.sql)

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
