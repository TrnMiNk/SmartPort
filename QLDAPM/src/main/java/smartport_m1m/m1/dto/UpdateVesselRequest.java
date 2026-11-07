
package smartport_m1m.m1.dto;

import java.math.BigDecimal;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import smartport_m1m.m1.validation.ValidImo;

public record UpdateVesselRequest(

    @NotBlank(message = "Ma tau khong duoc de trong")
    @Size(max = 50)
    String shipCode,

    @NotBlank(message = "Ten tau khong duoc de trong")
    @Size(max = 200)
    String shipName,

    @NotBlank(message = "Loai tau khong duoc de trong")
    @Size(max = 100)
    String shipType,

    @NotBlank(message = "IMO khong duoc de trong")
    @ValidImo
    String imoNumber,

    @NotNull
    @Positive
    @Digits(integer = 8, fraction = 2)
    BigDecimal capacity,

    @NotNull
    @Positive
    @Digits(integer = 8, fraction = 2)
    BigDecimal lengthOverall,

    @NotNull
    @Positive
    @Digits(integer = 8, fraction = 2)
    BigDecimal draft

) {}
