# Plan de implementacion

## Fase 1: Analisis y arquitectura

- Aprobar el modelo entidad-relacion.
- Aprobar los roles y permisos.
- Aprobar las reglas de operacion.
- Aprobar las convenciones de auditoria.

Estado: arquitectura y modelo aprobados para iniciar la configuración.

## Fase 2: Configuracion

- Inicializar React, TypeScript y Vite.
- Configurar Tailwind y tema.
- Crear cliente Supabase.
- Configurar variables de entorno y GitHub Pages.
- Crear workflow de despliegue.

Estado: completada y compilada.

## Fase 3: Diseño visual

- Crear shell responsive.
- Implementar sidebar y navegación móvil.
- Crear componentes base.
- Crear tema claro y oscuro.
- Crear dashboard visual inicial.

Estado: shell responsive, tema, login y dashboard inicial implementados. Los datos
operativos aparecen al configurar Supabase.

## Fase 4: Gestión de activos

- Crear y consultar activos.
- Implementar drones, controles y baterías.
- Implementar equipos auxiliares.
- Implementar fichas de vida y asignaciones temporales.

Estado: migración base preparada; registro y búsqueda inicial de activos ya conectados a
la interfaz. Edición transaccional de fichas con serial, adquisición, proveedor,
ubicación, responsable, observaciones y datos técnicos de baterías implementada.
La lista se organiza por categorías dinámicas con conteos y búsqueda por tipo. La hoja
de vida muestra el resumen del activo y una línea de tiempo de cambios, operaciones,
asignaciones, vuelos, mantenimientos y repuestos según permisos. Faltan adjuntos y
flujos de asignación manual.

## Fase 5: Operaciones

- Fincas y ubicaciones.
- Salidas y entregas.
- Entradas y devoluciones parciales.
- Operadores y responsables.
- Horas de vuelo.

Estado: salida transaccional, registro de fincas, perfiles operativos, devoluciones
parciales y captura del horómetro al regreso de cada dron implementados. La consulta
analítica y los reportes de horas siguen pendientes.

## Fase 6: Mantenimiento

- Tipos y planes configurables.
- Mantenimiento preventivo y correctivo.
- Repuestos utilizados.
- Alertas y próximas intervenciones.

Estado: registro de inicio/cierre, bloqueo del activo mientras hay una intervención
abierta, planes preventivos configurables y uso transaccional de repuestos al cierre
implementados. Alertas por vencer dentro del 10% del intervalo de horas o 7 días,
vencidas y con datos base faltantes implementadas. Faltan adjuntos y pruebas con datos
reales de Supabase.

## Fase 7: Inventario

- Repuestos por cantidad y serializados.
- Movimientos.
- Restricciones de existencias.
- Reparaciones y bajas.

Estado: catálogo de artículos, seriales únicos, saldos por ubicación, entradas,
consumos, instalaciones, traslados y bajas implementados con funciones transaccionales.
Los consumos de mantenimiento quedan vinculados a su intervención y activo. Faltan
alertas por mínimos, adjuntos y pruebas con datos reales de Supabase.

## Fase 8: Auditoria

- Eventos confirmados.
- Correcciones append-only.
- Integridad encadenada.
- Consultas y filtros históricos.

## Fase 9: Usuarios y seguridad

- Invitaciones.
- Roles y permisos.
- Políticas RLS.
- Pruebas de acceso.
- Auditoría administrativa.

## Fase 10: Reportes y publicación

- Reportes filtrables.
- Exportación Excel y PDF.
- Pruebas integrales.
- Documentación de operación.
- Despliegue final a GitHub Pages.

## Criterios de aprobación de la Fase 1

- Entidades y relaciones aprobadas.
- Un activo identificado de forma única.
- Asignaciones temporales aceptadas.
- Operaciones con devoluciones parciales aprobadas.
- Auditoria append-only aprobada.
- Roles iniciales aprobados.
- Convención de serial único aprobada.
- Modelo monopropietario inicial aceptado.

## Dependencia externa pendiente

El proyecto Supabase ya fue creado y se recibieron la URL y la clave Publishable; sin
embargo, las migraciones y la conexión real aún no se han probado desde este entorno.

La aplicación de migración, la prueba de RLS/autenticación y los flujos de operación
requieren ese proyecto. Sin él, la validación disponible es compilación, lint y parseo
sintáctico del SQL.
