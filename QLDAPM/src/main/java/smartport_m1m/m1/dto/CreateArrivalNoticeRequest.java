package smartport_m1m.m1.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record CreateArrivalNoticeRequest(
        @NotNull @Positive Long vesselId,
        @NotBlank @Size(max = 50) String voyageNo,
        @NotNull @Positive Long agentId,
        @NotNull @Positive Long originPortId,
        @NotBlank String declaredEta,
        @NotBlank @Size(max = 100) String cargoType,
        @NotNull @Min(0) Integer declaredTeu,
        @Size(max = 1000) String serviceRequest,
        @Min(0) Integer priorityLevel) {
}
