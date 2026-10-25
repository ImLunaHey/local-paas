//! Provider-neutral, explicitly opt-in CPU scaling for disposable HTTP replicas.
use crate::{Execution, ServiceSpec, Workload};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ScalingPolicy {
    pub enabled: bool,
    pub min_replicas: u16,
    pub max_replicas: u16,
    pub target_cpu_percent: u16,
    pub scale_up_window_seconds: u32,
    pub scale_down_window_seconds: u32,
    pub cooldown_seconds: u32,
    pub max_step: u16,
    pub idle_seconds: u32,
    pub node_names: Vec<String>,
    pub failure_domains: Vec<String>,
    pub prefer_failure_domain_spread: bool,
}
impl Default for ScalingPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            min_replicas: 1,
            max_replicas: 3,
            target_cpu_percent: 70,
            scale_up_window_seconds: 30,
            scale_down_window_seconds: 300,
            cooldown_seconds: 60,
            max_step: 1,
            idle_seconds: 600,
            node_names: vec![],
            failure_domains: vec![],
            prefer_failure_domain_spread: true,
        }
    }
}
impl ScalingPolicy {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.max_replicas == 0 || self.max_replicas > 32 || self.min_replicas > self.max_replicas
        {
            return Err(
                "scaling requires 0 <= minReplicas <= maxReplicas <= 32 and maxReplicas > 0",
            );
        }
        if !(10..=90).contains(&self.target_cpu_percent)
            || !(15..=3600).contains(&self.scale_up_window_seconds)
            || !(60..=3600).contains(&self.scale_down_window_seconds)
            || !(30..=3600).contains(&self.cooldown_seconds)
            || !(1..=4).contains(&self.max_step)
            || !(300..=86400).contains(&self.idle_seconds)
        {
            return Err(
                "invalid CPU target, stabilization window, cooldown, step limit or idle timeout",
            );
        }
        for labels in [&self.node_names, &self.failure_domains] {
            if labels.len() > 32
                || labels.iter().any(|s| {
                    s.is_empty()
                        || s.len() > 63
                        || !s
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
                })
            {
                return Err(
                    "placement selectors require at most 32 valid node/failure-domain labels",
                );
            }
        }
        Ok(())
    }
    pub fn eligible(spec: &ServiceSpec) -> bool {
        spec.volume.is_none()
            && matches!(
                spec.workload,
                Workload::OciService {
                    execution: Execution::Http,
                    pre_deploy: None,
                    ..
                }
            )
    }
    /// A dead band avoids scale-in near the target. Zero is separately gated on ingress idleness.
    pub fn recommendation(&self, current: u16, cpu_percent: f64) -> u16 {
        if !cpu_percent.is_finite() || cpu_percent < 0.0 {
            return current;
        }
        let target = f64::from(self.target_cpu_percent);
        let proposed = if cpu_percent > target * 1.1 {
            (f64::from(current) * cpu_percent / target).ceil() as u16
        } else if cpu_percent < target * 0.5 {
            (f64::from(current) * cpu_percent / target).ceil().max(1.0) as u16
        } else {
            current
        };
        proposed.clamp(self.min_replicas.max(1), self.max_replicas)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn load_trace_scales_out_and_in_without_flapping() {
        let p = ScalingPolicy::default();
        assert!(!p.enabled);
        let mut replicas = 1;
        for cpu in [100.0, 100.0, 70.0, 65.0, 75.0] {
            let target = p.recommendation(replicas, cpu);
            replicas = target.min(replicas + p.max_step);
        }
        assert_eq!(replicas, 3);
        assert_eq!(p.recommendation(3, 10.0), 1);
        assert_eq!(p.recommendation(3, f64::NAN), 3);
        assert!(
            ScalingPolicy {
                max_replicas: 0,
                ..p.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            ScalingPolicy {
                cooldown_seconds: 0,
                ..p
            }
            .validate()
            .is_err()
        );
    }
}

#[cfg(test)]
mod eligibility_tests {
    use super::*;
    #[test]
    fn rejects_workers_storage_fleets_and_release_commands() {
        let mut spec: ServiceSpec =
            serde_json::from_str(include_str!("../../../examples/oci-service.json")).unwrap();
        assert!(ScalingPolicy::eligible(&spec));
        if let Workload::OciService { execution, .. } = &mut spec.workload {
            *execution = Execution::Worker;
        }
        assert!(!ScalingPolicy::eligible(&spec));
        if let Workload::OciService {
            execution,
            pre_deploy,
            ..
        } = &mut spec.workload
        {
            *execution = Execution::Http;
            *pre_deploy = Some(crate::PreDeploy {
                command: vec!["migrate".into()],
                timeout_seconds: 60,
            });
        }
        assert!(!ScalingPolicy::eligible(&spec));
        if let Workload::OciService { pre_deploy, .. } = &mut spec.workload {
            *pre_deploy = None;
        }
        spec.volume = Some(crate::VolumeAttachment {
            id: uuid::Uuid::nil(),
            mount_path: "/data".into(),
            read_only: true,
        });
        assert!(!ScalingPolicy::eligible(&spec));
    }
}
