# Seguridad, roles y auditoria

## Autenticacion

- No habra registro publico.
- Los usuarios entraran mediante correo y contraseña de Supabase Auth.
- El alta sera realizada por un administrador autorizado.
- Las credenciales y la sesion deben administrarse por Supabase.
- La clave `anon` sera la unica clave publicable en el frontend.
- La clave `service_role` nunca se incluira en el codigo cliente, repositorio o variables
  visibles de GitHub Pages.

## Roles iniciales

| Rol | Funciones principales |
|---|---|
| Administradora / Gerencia | Consulta global, reportes, supervisión y auditoria |
| Administrador del sistema | Usuarios, configuracion y catalogos |
| Responsable de operaciones | Operaciones, entregas y devoluciones |
| Tecnico de drones | Mantenimiento, diagnostico y horas de vuelo |
| Encargado de inventario | Repuestos y movimientos |
| Operador | Consulta de asignaciones y registro operativo autorizado |

Los permisos deben mantenerse separados del nombre visual del rol. Si un rol necesita
variar entre organizaciones o usuarios, se usan permisos granulares y no una nueva
condición codificada en el frontend.

## Row Level Security

Toda tabla privada requiere RLS. Las políticas deben comprobar:

1. Usuario autenticado.
2. Membresia activa.
3. Organizacion solicitada.
4. Permiso de la acción.
5. Condiciones del estado o entidad, cuando corresponda.

Las validaciones del frontend mejoran la experiencia, pero no sustituyen funciones SQL,
constraints ni políticas RLS.

Las referencias a responsables, operadores, entregas y recepciones se validan en la
base de datos contra membresías activas de la organización. Los nombres visibles se
guardan en `user_profiles`; no se expone el catálogo interno de Supabase Auth.

## Operaciones concurrentes

Las asignaciones incompatibles deben detectarse y prevenirse dentro de PostgreSQL.
Las operaciones que modifican varios activos deben ejecutarse en una unica transaccion.
Las operaciones concurrentes deben bloquear o verificar los activos relevantes dentro de
esa transaccion.

## Auditoria append-only

`audit_events` debe contener:

- identificador
- fecha del servidor
- usuario
- tipo de evento
- activo relacionado
- operación relacionada
- estado anterior
- estado nuevo
- descripcion
- referencia al evento corregido
- motivo de corrección

Los usuarios normales no tendran permisos SQL de actualización o eliminación sobre la
tabla de auditoria. Los triggers y permisos deben rechazar cambios ordinarios.

La base de datos actual registra automáticamente operaciones de inserción, actualización
y eliminación en las entidades de negocio, con snapshots JSON anteriores y posteriores.
Los eventos se encadenan por organización con SHA-256; `verify_audit_chain` permite
comprobar la secuencia para personas con permiso de auditoría.

Los eventos generados por migraciones o consultas privilegiadas desde SQL Editor pueden
tener `actor_user_id` nulo porque esas herramientas no incluyen el contexto JWT del
usuario final. Las operaciones de la aplicación usan la identidad autenticada.

Las tablas de activos y operaciones no conceden borrado a usuarios de la aplicación.
Los registros de vuelo, movimientos de inventario y documentos confirmados además
rechazan cambios o eliminación; el inventario se modifica mediante movimientos y los
activos se desactivan en vez de borrarse.

Los registros de mantenimiento solo pueden crearse o modificarse mediante funciones
transaccionales autorizadas. Una intervención abierta mantiene el activo bloqueado
contra operaciones, liberación de estado y desactivación; los registros cerrados no
pueden reescribirse.

El inventario tampoco acepta cambios directos de existencias desde el cliente: la
creación de artículos y los movimientos se realizan mediante funciones transaccionales.
El historial de movimientos no permite edición o borrado, las salidas validan el saldo
de la ubicación y las transferencias conservan el total disponible.

La edición de fichas de activos valida organización, ubicación, proveedor y responsable
en la base de datos. Cada cambio genera auditoría; las horas de vuelo no se pueden
alterar desde el formulario y los datos de ubicación/responsable quedan bloqueados
mientras el activo tenga una operación abierta.

El cierre de un mantenimiento con repuestos valida permisos de mantenimiento y
existencias en la base de datos, con descuento y cierre atómicos. Si cualquier repuesto
no tiene stock suficiente, la operación completa se revierte sin cerrar la intervención.

Una corrección debe:

1. Conserva el evento original.
2. Crea un nuevo evento de corrección.
3. Incluye usuario, fecha y motivo.
4. Referencia el evento corregido.
5. No sobrescribe ni elimina el dato original.

La interfaz y las funciones de corrección controlada aún no están implementadas. Hasta que
se agreguen, una corrección de datos de negocio debe ser atendida por un proceso
administrativo controlado que conserve el registro original y deje evidencia; no se debe
editar directamente el historial ni eliminar datos confirmados.

La cadena de hashes mejora la detección de alteraciones en el contenido y orden de eventos,
pero no sustituye un respaldo independiente ni protege frente a un administrador que pueda
modificar tanto los eventos como la cadena.

## Limitaciones

Una auditoria dentro de Supabase puede resistir cambios ordinarios y usuarios de la
aplicacion, pero no garantiza inmutabilidad frente a administradores con control directo
de la infraestructura o credenciales privilegiadas.

Los mecanismos recomendados son:

- mínimo privilegio
- separación de credenciales
- backups externos independientes
- pruebas de restauracion
- alertas de cambios administrativos
- registro inmutable o de tamper-evident fuera de la base cuando el presupuesto lo permita

## Archivos privados

Los documentos y fotografías deben almacenarse en buckets privados. Las URLs usadas por
la interfaz deben tener expiracion limitada y comprobar permisos. Las rutas publicas no
deben incluir datos empresariales sensibles.
