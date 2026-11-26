{{- define "fomo.name" -}}{{ .Release.Name }}{{- end -}}

{{- define "fomo.labels" -}}
app.kubernetes.io/name: model-fomo
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "fomo.secretName" -}}
{{- .Values.secrets.existingSecret | default (printf "%s-secrets" .Release.Name) -}}
{{- end -}}

{{/* Environment shared by every container: config map + secret. */}}
{{- define "fomo.env" -}}
envFrom:
  - configMapRef:
      name: {{ include "fomo.name" . }}-config
  - secretRef:
      name: {{ include "fomo.secretName" . }}
{{- end -}}
