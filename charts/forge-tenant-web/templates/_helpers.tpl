{{- define "forge-tenant-web.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if dig "forge" "enabled" false (.Values.global | default dict) -}}
{{- printf "%s-web" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- .Release.Name -}}
{{- end -}}
{{- end -}}

{{- define "forge-tenant-web.nginxName" -}}
{{- printf "%s-nginx" (include "forge-tenant-web.fullname" . | trunc 57 | trimSuffix "-") -}}
{{- end -}}

{{- define "forge-tenant-web.apiUpstream" -}}
{{- if dig "forge" "enabled" false (.Values.global | default dict) -}}
{{- printf "https://%s-tenant.%s.svc:8443" .Release.Name .Release.Namespace -}}
{{- else -}}
{{- required "api.upstream is required" .Values.api.upstream -}}
{{- end -}}
{{- end -}}

{{- define "forge-tenant-web.metadataUpstream" -}}
{{- if dig "forge" "enabled" false (.root.Values.global | default dict) -}}
{{- printf "https://%s-artifact.%s.svc:8443" .root.Release.Name .root.Release.Namespace -}}
{{- else -}}
{{- index .root.Values .name "upstream" -}}
{{- end -}}
{{- end -}}

{{- define "forge-tenant-web.trustBundle" -}}
{{- if dig "forge" "enabled" false (.Values.global | default dict) -}}
{{- printf "%s-web-trust" .Release.Name -}}
{{- else -}}
{{- .Values.trustBundleConfigMap | default "" -}}
{{- end -}}
{{- end -}}
