# Configuracion local y despliegue

## Requisitos

- Node.js 22 o superior
- npm
- Una cuenta de GitHub
- Un proyecto Supabase

## Crear y preparar Supabase

1. Crea un proyecto Supabase; no actives un plan pago sin autorización.
2. Deshabilita el registro público en Authentication.
3. Abre SQL Editor en el proyecto y ejecuta las migraciones que aún falten, en este orden:
   - `supabase/migrations/20261125130000_initial_schema.sql`
   - `supabase/migrations/20261125134500_maintenance_workflows.sql`
   - `supabase/migrations/20261125143000_inventory_workflows.sql`
   - `supabase/migrations/20261125150000_asset_profile_editing.sql`
   - `supabase/migrations/20261125153000_maintenance_inventory_integration.sql`
   - `supabase/migrations/20261125154500_maintenance_alerts.sql`
   - `supabase/migrations/20261125160000_asset_assignment_workflows.sql`
   - `supabase/migrations/20261125161000_pilot_management.sql`
   - `supabase/migrations/20261125162000_inventory_minimum_stock.sql`
   - `supabase/migrations/20261125163000_private_document_attachments.sql`
   - `supabase/migrations/20261125164000_reporting_access.sql`
   - `supabase/migrations/20261125165000_maintenance_reporting_access.sql`
   - `supabase/migrations/20261125170000_user_management.sql`
   - `supabase/migrations/20261127130000_farm_flight_and_pilot_workflows.sql`
   La migración de alertas usa `create or replace` y se puede volver a ejecutar para
   actualizar la función si se corrige. Si ya la ejecutaste y las alertas muestran un
   error de columna ambigua, vuelve a ejecutar únicamente
   `20261125154500_maintenance_alerts.sql`. No vuelvas a ejecutar otras migraciones que
   ya se aplicaron correctamente. La integración de repuestos requiere las migraciones
   de mantenimiento e inventario; si alguna falta, aplícala antes de la integración.
   La migración de edición de fichas puede conservarse en su orden, pero no se debe
   repetir si ya fue aplicada. La migración de asignaciones manuales crea flujos
   transaccionales para asignar responsables y asociar componentes a drones, conserva
   el historial al liberar y sincroniza los responsables que ya estén en las fichas.
   Si las migraciones anteriores ya se aplicaron, ejecuta únicamente
   `20261125160000_asset_assignment_workflows.sql`; no la ejecutes más de una vez.
   Si ya aplicaste la migración de asignaciones, aplica únicamente
   `20261125161000_pilot_management.sql`. Si aún no la aplicaste, ejecuta primero
   `20261125160000_asset_assignment_workflows.sql` y después la migración de pilotos,
   cada una una sola vez. La nueva migración crea el catálogo privado de pilotos y
   registra un piloto por cada dron de la operación; no crea cuentas de Supabase Auth.
   Si ya aplicaste las migraciones anteriores, ejecuta únicamente
   `20261125162000_inventory_minimum_stock.sql`, una sola vez. Agrega el mínimo
   configurable por artículo y habilita su edición sin permitir cambiar existencias fuera
   de los movimientos registrados.
   Si ya aplicaste las anteriores, ejecuta únicamente
   `20261125163000_private_document_attachments.sql`, una sola vez. Habilita archivos
   privados para activos, intervenciones e inventario, y limita la lectura a los permisos
   del módulo asociado.
   Si ya ejecutaste las anteriores, aplica únicamente
   `20261125164000_reporting_access.sql`, una sola vez. Permite que el permiso
   `reports.read` consulte los datos necesarios para los informes sin otorgar permisos
   para crear o modificar registros.
   Si ya ejecutaste las anteriores, aplica únicamente
   `20261125165000_maintenance_reporting_access.sql`, una sola vez. Habilita la consulta
   de intervenciones y tipos de mantenimiento al permiso `reports.read`.
   Si las migraciones anteriores ya están aplicadas, ejecuta únicamente
   `20261125170000_user_management.sql`, una sola vez. Crea contactos de usuario visibles
   únicamente a administradores, protege la última cuenta con `users.manage` y agrega las
   funciones transaccionales para vincular miembros y cambiar roles o estado.
   Si ya aplicaste las migraciones previas, ejecuta únicamente
   `20261127130000_farm_flight_and_pilot_workflows.sql` desde SQL Editor, una sola vez.
   Esta migración permite registrar horas por operación conservando las lecturas históricas
   del horómetro y evita asignar un piloto que ya esté en una operación abierta.
4. Invita a la primera cuenta desde Authentication. No habilites el registro público.
5. Obtén el UUID de esa cuenta en Authentication y ejecuta, reemplazando el texto
   marcador:

```sql
insert into public.memberships (org_id, user_id, role_id)
select
  'c148841e-76e7-4ee2-b514-1ca7ce9836ad'::uuid,
  'REEMPLAZAR_POR_UUID_DEL_USUARIO'::uuid,
  r.id
from public.roles r
where r.org_id = 'c148841e-76e7-4ee2-b514-1ca7ce9836ad'::uuid
  and r.code = 'system_admin'
on conflict (org_id, user_id) do nothing;
```

La primera cuenta queda como administradora técnica. Después de aplicar la migración de
gestión de usuarios, esta cuenta puede invitar y administrar miembros desde Configuración.
Para que las invitaciones funcionen, publica la función segura de Supabase una sola vez:

```powershell
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase secrets set APP_ORIGIN=https://skylogicmanagement.github.io
npx supabase functions deploy invite-organization-user
```

La función usa las variables administradas `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` del entorno Supabase. Nunca copies la clave `service_role` a
la aplicación, GitHub Pages o el repositorio. La cuenta invitada recibirá el correo de
Supabase Auth; configura SMTP de producción si no quieres depender del servicio de correo
limitado de prueba. En Authentication > URL Configuration, configura como Site URL
`https://skylogicmanagement.github.io/skylogicmanagement/` y agrega esa URL a la lista
de redirecciones permitidas. Los usuarios existentes también pueden agregarse a la
organización desde la misma pantalla. Cada miembro deberá completar su nombre visible
antes de ser seleccionado como responsable en una salida o devolución.

La creación de perfiles operativos no crea cuentas de autenticación ni otorga permisos:
las cuentas se invitan desde Supabase Auth y el rol se asigna en `memberships`.

La migración crea el tenant Sky Logic, los roles y permisos iniciales, tipos de activo,
ubicaciones genéricas, Sky One y Sky Two, dos controles y seis baterías. No asigna
números de serie, valores, fechas, proveedores ni ubicación actual a los activos; el
estado inicial queda como **no verificado**.

Las asignaciones manuales requieren el permiso `operations.manage`. En Activos se puede
consultar el dron o responsable asociado y gestionar las asignaciones actuales; cada
liberación queda en el historial y no elimina el registro.

Las migraciones configuran tablas privadas, RLS, triggers de auditoría, reglas de
asignación, horas de vuelo, movimientos de inventario, flujos transaccionales de
mantenimiento y un bucket privado de archivos. La migración de inventario agrega
control individual de seriales, saldos por ubicación y funciones transaccionales para
crear artículos y registrar movimientos. La migración de fichas permite editar los
datos generales y técnicos permitidos desde la aplicación. La integración con
mantenimiento permite consultar cantidades disponibles y descontar repuestos al cerrar
una intervención. La migración de alertas calcula vencimientos por horas y calendario
con umbrales de proximidad de 10% del intervalo o 7 días. El mínimo de inventario se
configura por artículo; cuando la existencia total es igual o inferior a ese mínimo,
aparece una alerta en Inventario. El valor cero desactiva solo el umbral; los artículos
agotados se siguen mostrando como alerta. No ingreses datos reales hasta confirmar que
las migraciones aplicables terminaron correctamente.
Los adjuntos son privados, aceptan JPG, PNG, WebP y PDF de hasta 25 MB, y se consultan
mediante enlaces temporales autenticados desde la ficha del activo, el historial de
mantenimiento o el artículo de inventario.
El módulo Reportes ofrece el detalle de horas de vuelo por fechas, dron y finca y descarga
un CSV; también resume mantenimientos por fecha, estado, costo, activo y técnico. Requiere
`reports.read`.

## Instalacion local

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Completa `.env` con la URL del proyecto y la clave **Publishable** que muestra Supabase.
Supabase la considera una clave pública para clientes web; la protección de los datos
depende de RLS y los permisos de la base, no de ocultar esta clave.

No agregues el valor `service_role` a ningún archivo del frontend ni a las variables
VITE de GitHub Actions.

## Variables

| Variable | Uso |
|---|---|
| `VITE_SUPABASE_URL` | URL pública del proyecto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave Publishable pública del proyecto; protegida por RLS |

Sin estas variables, la aplicación mostrará una pantalla de configuración y no datos
ficticios.

## GitHub Pages

La configuración usa el subdirectorio `/skylogicmanagement/`. Si el repositorio cambia
de nombre, también debe actualizarse `base` en `vite.config.ts`.

La navegación usa HashRouter para evitar depender de rewrites en GitHub Pages.

Configura estos secrets en GitHub:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

La URL y la clave Publishable son valores de cliente; nunca uses la clave `service_role`
en esta aplicación.

### Despliegue

1. Publica el proyecto en GitHub.
2. Configura GitHub Pages con Source: GitHub Actions.
3. Agrega los dos secrets anteriores.
4. Publica cambios en la rama `main`.
5. El workflow construirá y desplegará automáticamente.

## Respaldo y costos

Verifica límites y políticas vigentes de base de datos, almacenamiento, transferencia,
autenticación y Realtime antes de producción. Esta configuración no crea backups externos
automáticos. Define y prueba un proceso de exportación independiente antes de almacenar
información operativa real. Ninguna ampliación a un plan pago debe hacerse sin autorización.
