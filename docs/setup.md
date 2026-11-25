# Configuracion local y despliegue

## Requisitos

- Node.js 22 o superior
- npm
- Una cuenta de GitHub
- Un proyecto Supabase

## Crear y preparar Supabase

1. Crea un proyecto Supabase; no actives un plan pago sin autorización.
2. Deshabilita el registro público en Authentication.
3. Abre SQL Editor en el proyecto y ejecuta, en este orden, las migraciones completas:
   - `supabase/migrations/20261125130000_initial_schema.sql`
   - `supabase/migrations/20261125134500_maintenance_workflows.sql`
   - `supabase/migrations/20261125143000_inventory_workflows.sql`
   Si ya ejecutaste la primera migración, ejecuta solamente la segunda; no vuelvas a
   ejecutar la primera sobre un esquema ya creado. Si ya ejecutaste las migraciones
   inicial y de mantenimiento, ejecuta solamente la de inventario.
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

La primera cuenta queda como administradora técnica. Luego podrá invitar personas desde
Supabase Auth y asignarles su rol agregando su membresía. La pantalla de gestión de
usuarios se implementará en una fase posterior. Cada miembro deberá completar su nombre
visible desde el módulo Operaciones antes de ser seleccionado como responsable en una
salida o devolución.

La creación de perfiles operativos no crea cuentas de autenticación ni otorga permisos:
las cuentas se invitan desde Supabase Auth y el rol se asigna en `memberships`.

La migración crea el tenant Sky Logic, los roles y permisos iniciales, tipos de activo,
ubicaciones genéricas, Sky One y Sky Two, dos controles y seis baterías. No asigna
números de serie, valores, fechas, proveedores ni ubicación actual a los activos; el
estado inicial queda como **no verificado**.

Las migraciones configuran tablas privadas, RLS, triggers de auditoría, reglas de
asignación, horas de vuelo, movimientos de inventario, flujos transaccionales de
mantenimiento y un bucket privado de archivos. La migración de inventario agrega
control individual de seriales, saldos por ubicación y funciones transaccionales para
crear artículos y registrar movimientos. No ingreses datos reales hasta confirmar que
las tres migraciones terminaron correctamente.

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
