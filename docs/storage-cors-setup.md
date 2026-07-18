# Cloud Storage CORS setup (required for "Convert to note")

Receipt images are stored in the project's Cloud Storage bucket. Showing
them in the app (`<img>` tags) works out of the box, but *reading their
bytes from JavaScript* — which the **Convert receipt image to note**
feature needs — is subject to the browser's CORS policy. By default a
Firebase Storage bucket serves no `Access-Control-Allow-Origin` header
on downloads, so every in-browser download fails with:

```
Access to XMLHttpRequest at 'https://firebasestorage.googleapis.com/...'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header
is present on the requested resource.
```

This is a one-time, per-bucket configuration (see the official Firebase
docs: [Download files → CORS configuration](https://firebase.google.com/docs/storage/web/download-files#cors_configuration)).

## Apply the configuration

With the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
authenticated against your Firebase project:

```bash
./scripts/setup-storage-cors.sh <your-bucket>
# e.g.
./scripts/setup-storage-cors.sh my-project.firebasestorage.app
```

The bucket name is the `storageBucket` value in your Firebase config
(`.vscode/environment.ts`). You can also run it from the
[Cloud Shell](https://console.cloud.google.com/) if you don't want to
install the CLI locally:

```bash
echo '[{"origin":["*"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
gcloud storage buckets update gs://<your-bucket> --cors-file=cors.json
```

## What the configuration allows

[`storage.cors.json`](../storage.cors.json) permits cross-origin **GET**
requests only. It does not weaken access control: object reads are still
governed by the Storage security rules (`storage.rules`) and the
download-token mechanism — CORS merely lets the browser hand the bytes
of an already-authorized response to JavaScript.

To restrict which sites may embed in-browser downloads, replace
`"origin": ["*"]` with your app's origins, e.g.:

```json
[
  {
    "origin": [
      "http://localhost:4200",
      "https://your-project.web.app",
      "https://your-project.firebaseapp.com"
    ],
    "method": ["GET"],
    "maxAgeSeconds": 3600
  }
]
```
