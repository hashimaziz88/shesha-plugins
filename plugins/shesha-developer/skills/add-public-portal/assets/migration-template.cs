// FluentMigrator migration to register a new front-end application (public portal).
// Copy to: backend/src/Module/<Project>.Domain/Migrations/M<yyyyMMddHHmmss>.cs
// Replace: <Project>, the timestamp, and the three app values.
// The app_key MUST be lowercase, no spaces, and identical to the portal folder name
// and the applicationKey in app-provider.tsx.

using FluentMigrator;
using Shesha.FluentMigrator;

namespace <Project>.Domain.Migrations
{
    [Migration(20260717120000)] // <-- yyyyMMddHHmmss, must be unique & greater than the last migration
    public class M20260717120000 : OneWayMigration
    {
        /// <summary>
        /// Registers a new public portal front-end application.
        /// </summary>
        public override void Up()
        {
            Execute.Sql(@"
                IF NOT EXISTS (
                    SELECT 1 FROM [frwk].[front_end_apps]
                    WHERE [app_key] = 'publicportal2'          -- <-- portal app key
                )
                BEGIN
                    INSERT INTO [frwk].[front_end_apps]
                    ( [id], [creation_time], [creator_user_id], [is_deleted], [tenant_id],
                      [name], [description], [app_key] )
                    VALUES
                    ( NEWID(), GETDATE(), NULL, 0, NULL,
                      'Public Portal 2',                       -- <-- display name
                      'Public-facing portal application',      -- <-- description
                      'publicportal2' );                       -- <-- MUST match app_key above
                END
            ");
        }
    }
}