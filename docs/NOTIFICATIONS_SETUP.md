# Notifications

Les préférences sont enregistrées dans `profiles`. La migration `034_granular_notifications.sql` définit `notif_push_duels`, `notif_push_daily`, `notif_email_duels`, `notif_email_daily` et `notif_newsletter`. Les abonnements Web Push sont stockés dans `push_subscriptions`.

## Configuration serveur

Le backend lit les variables suivantes dans son environnement :

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_MAILTO` pour Web Push;
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` pour les emails;
- `SCHEDULER_ENABLED=false` pour désactiver les rappels planifiés, notamment sur un environnement qui ne doit pas envoyer de notifications.

Les clés VAPID doivent rester stables tant que les abonnements existants sont conservés. Configurer ces valeurs dans les secrets de l'environnement GitHub concerné et dans l'environnement du backend; ne pas les committer ni les afficher dans des journaux.

## Diagnostic

1. Vérifier dans Supabase que la migration 034 est appliquée et que `push_subscriptions` existe.
2. Vérifier les préférences de l'utilisateur dans **Paramètres → Notifications** et l'autorisation du navigateur. Web Push exige HTTPS, sauf sur `localhost`.
3. Consulter les journaux du backend pour les erreurs VAPID, SMTP ou scheduler. Le rappel quotidien est planifié à 17:00, selon le fuseau local du serveur.
4. Vérifier `GET /api/notifications/vapid-public-key` et, avec un jeton utilisateur valide, `GET /api/notifications/preferences`.

Les notifications de duel sont envoyées lorsque la préférence correspondante est activée. Les rappels quotidiens n'incluent que les utilisateurs ayant activé `notif_push_daily` ou `notif_email_daily`.
