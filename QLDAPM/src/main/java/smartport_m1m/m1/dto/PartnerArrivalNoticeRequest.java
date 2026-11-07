package smartport_m1m.m1.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record PartnerArrivalNoticeRequest(
        @NotBlank @Pattern(regexp = "[0-9]{7}") String vesselImo,
        @NotBlank @Size(max = 50) String voyageNo,
        @NotBlank @Size(max = 20) String originPortCode,
        @NotBlank String declaredEta,
        @NotBlank @Size(max = 100) String cargoType,
        @NotNull @Min(0) Integer declaredTeu,
        @Size(max = 1000) String serviceRequest) { }
